# Operations

Running a deployment day to day: health, logs, alarms, background jobs and their
schedules, payment reconciliation, backups, migrations, rotating secrets, the
least-privilege database role and scaling. Names below use `<name_prefix>` from
`terraform.tfvars`.

## Health endpoints

| Endpoint | Answers | Used by |
| --- | --- | --- |
| `GET /up` | `{ ok: true }` while the process runs | The container health check |
| `GET /api/ready` | `{ ok: true }` when Postgres and Redis answer, else 503 | The ALB target group health check |
| `GET /` (web) | 200 when Next renders | The web target group |

Neither is logged by the access log.

## Logs

Every service logs pino JSON to CloudWatch Logs, group `/open-lms/<name_prefix>/<service>`
(`api`, `worker`, `web`, `migrate`, `admin`). Each API line carries the request id that
error bodies return as `requestId`, so a learner's support ticket with a request id finds the
line. Secrets are redacted ([security.md](../architecture/security.md#12-logging)).

Useful filters (CloudWatch Logs Insights):

```
fields @timestamp, msg, job, attempts | filter level >= 50 | sort @timestamp desc
fields @timestamp, msg | filter msg like /webhook rejected/
fields @timestamp, msg, orderId | filter msg like /amount does not match/
```

Locally: `make logs SERVICE=api` (or `worker`, `web`, `stubs`).

## Alarms and dashboard

The observability module ([`infra/terraform/modules/observability/main.tf`](../../infra/terraform/modules/observability/main.tf))
sends alarms to the SNS topic `<name_prefix>-alarms` (subscribe an address with
`alarm_email`) and builds one dashboard named `<name_prefix>`:

| Alarm | Fires when | Look at |
| --- | --- | --- |
| `<prefix>-api-5xx`, `<prefix>-web-5xx` | More than 25 target 5xx in 5 minutes | API logs by request id |
| `<prefix>-api-unhealthy`, `<prefix>-web-unhealthy` | Any target failing health checks | `/api/ready`: Postgres or Redis |
| `<prefix>-<service>-cpu`, `-memory` | Above 85% for 5 minutes | Scaling limits, a hot endpoint |
| `<prefix>-db-cpu`, `-db-storage`, `-db-connections` | CPU above 80%, free storage below 5 GiB, connections above 80% of 200 | Slow queries, pool sizes times task counts |
| Redis memory | Above 80% of maxmemory (`noeviction`: writes fail at 100%) | Queue backlogs |
| `<prefix>-worker-failed-jobs` | More than 5 failed job attempts in 5 minutes | Worker log lines with a `job` field |

## Background jobs

Handlers and what each does are listed in [LLD.md](../architecture/LLD.md#8-background-jobs).
The schedules, registered by every worker on boot (one schedule each, however many workers
run), are:

| Job | Every | If it stops |
| --- | --- | --- |
| `billing.reconcile-pending` | 10 min | Orders whose webhook was lost stay PENDING until the learner revisits the return page |
| `billing.expire-subscriptions` | 30 min | Rows keep their last status instead of EXPIRED. Access still ends on time, because it is computed from the period end (plus grace for PAST_DUE). What is lost is the recovery from a missed renewal webhook: this job is what asks the gateway for the new period |
| `notify.email` | 5 min | Notification emails missed by their per-notification job are not swept |
| `maintenance.expire-uploads` | 30 min | Abandoned uploads accumulate in the bucket |
| `maintenance.lift-suspensions` | 5 min | Timed suspensions end anyway on the user's next request (lifted lazily), but the row keeps `SUSPENDED` |
| `maintenance.reconcile-counters` | 6 h | Counter drift (enrollments, ratings, items, replies) is not corrected |
| `maintenance.purge-accounts` | 6 h | Accounts past their 14-day deletion grace are not anonymised |

Jobs retry 5 times with exponential backoff from 5 s; the last 5000 failures are kept in
Redis. To look at a queue from a task or bastion with access to Redis:

```bash
redis-cli -u "$REDIS_URL" ZRANGE bull:invoices:failed 0 -1     # failed job ids
redis-cli -u "$REDIS_URL" HGETALL bull:invoices:<job id>        # its data and error
redis-cli -u "$REDIS_URL" LLEN bull:notify:wait                 # backlog
```

A failed `invoices.render` or `certificates.render` leaves `pdf_key` NULL; the download says
it is still rendering. Re-enqueue by retrying the failed job (BullMQ's retry, from any BullMQ
UI pointed at the Redis) or by running the render function from a one-off task; both are
idempotent.

## Payment reconciliation

The reconcile job asks the gateway about every PENDING order past its window
(`settings.learning.orderTtlMinutes`, 60 by default), fulfils the paid ones and expires the
rest. What still needs a person shows on the order page (`/admin/orders/<id>`, the event
timeline lists every webhook with its outcome):

| Flag (`failure_reason`) | Meaning | Action |
| --- | --- | --- |
| `AMOUNT_MISMATCH` | The gateway captured a different amount or currency than the order | Check the gateway dashboard; refund the payment at the gateway, then cancel the order. Each reconcile run audits it again until it is resolved |
| `PAID_AFTER_CANCEL` | Money arrived for an order the learner had cancelled | Refund it from the order page, or grant the course by hand |
| An order stuck PENDING with `GATEWAY_UNREACHABLE` in the worker log | The gateway did not answer | Wait; the next run retries |

Audit actions to search for (`/admin/audit?action=`): `order.amount_mismatch`,
`order.paid_after_cancel`, `coupon.over_redeemed`, `refund.over_settled`,
`subscription.renewal_amount_mismatch`, `subscription.activation_skipped`. Playbook:
[grading-and-moderation.md](grading-and-moderation.md#orders-that-need-a-person).

## Backups and recovery

### Database

RDS automated backups are kept 3 days in aws-dev and 14 in aws-prod (window 03:00 to 04:00
UTC), with point-in-time recovery inside that window. aws-prod runs Multi-AZ with deletion
protection; destroying with protection off takes a final snapshot `<name_prefix>-db-final`.
To restore, create a new instance from a snapshot or a point in time, point the deployment at
it, and roll the services. Everything durable is in Postgres: orders, invoices, enrollments,
progress, attempts, submissions, certificates.

After a point-in-time restore, gateways still hold payments made after the restore point:
run the reconcile job (it only sees PENDING orders), and compare the gateway dashboards with
`/admin/orders` for that window. Webhooks redelivered by the gateways are processed again
because their `payment_events` rows are gone.

### Redis

ElastiCache snapshots are kept 1 day in aws-dev and 7 in aws-prod. Redis holds nothing that
cannot be rebuilt, but losing it loses queued and delayed jobs (receipts, PDF renders,
image processing not yet run), the repeatable schedules until a worker restarts, and the
rate-limit counters.

### Media

The bucket is versioned in AWS environments; replaced or deleted objects stay 30 days as
noncurrent versions, and incomplete multipart uploads are removed after a day. Invoice and
certificate PDFs can be re-rendered from the database rows; uploads cannot.

## Migrations

[`db/migrate.ts`](../../db/migrate.ts) applies `db/migrations/NNNN_*.sql` in filename order,
each in its own transaction, recording the name and a SHA-256 checksum in
`schema_migrations`. Forward-only: an applied file must never change; add a new file. Advisory
lock `727101` makes concurrent runs safe.

| Where | How |
| --- | --- |
| Local compose | The `migrate` one-shot runs before `api` and `worker` |
| AWS | `make aws-deploy` runs the migrate task before rolling out; `make aws-migrate ENV=...` alone |
| Anywhere | `pnpm db:migrate` (or `--status`) with `DATABASE_URL` set |
| On boot | `MIGRATE_ON_BOOT=true` (off by default) |

Write migrations the old code tolerates: add columns and tables first, drop them later.

## Rotating secrets

| Secret | Where | Rotate by | Effect |
| --- | --- | --- | --- |
| `JWT_SECRET` | `<name_prefix>/app` | Put a new version (32+ characters, different from `REFRESH_SECRET`), roll api and worker | Outstanding access tokens fail; clients refresh with their cookie and stay signed in |
| `REFRESH_SECRET` | `<name_prefix>/app` | Same | Refresh tokens are random values stored as hashes, so sessions keep working |
| `TOTP_ENCRYPTION_KEY` | `<name_prefix>/totp` | Not in place: it encrypts every stored TOTP secret | A new key makes them unreadable; two-factor users must enrol again |
| Redis AUTH token | `<name_prefix>/redis` | `terraform apply -replace=module.lms.module.cache.random_password.auth`, roll api and worker | Tasks pick up the new `REDIS_URL` on restart |
| RDS master password | RDS-managed secret | Rotated by RDS | Nothing to do: read per new connection, cached 60 s |
| Application database role | `<name_prefix>/db-app` | `ALTER ROLE ... PASSWORD`, then `put-secret-value` at once | New connections may fail for up to 60 s |
| `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_SECRET` | `<name_prefix>/payments` | Roll the key in the dashboard, put the full JSON, roll api and worker | Running tasks keep the old key until replaced; keep the old key valid until the roll finishes |
| `STRIPE_WEBHOOK_SECRET` | `<name_prefix>/payments` | Roll the endpoint secret in Stripe (it signs with both for a while), put, roll | Any matching `v1` signature is accepted |
| `RAZORPAY_WEBHOOK_SECRET` | `<name_prefix>/payments` | Change it on the webhook and in the secret together, then roll | Deliveries in between fail verification and are retried by Razorpay |
| `EVS_PLAYBACK_KEY`, `EVS_READ_KEY`, `EVS_WEBHOOK_SECRET` | `<name_prefix>/evs` | Create the new key in EVS, put, roll, revoke the old key | Playback keeps working through the roll |
| `OPENAI_API_KEY` | `<name_prefix>/openai` | Put, roll | |
| CloudFront origin header | Terraform state | `terraform apply -replace='module.lms.random_password.origin_verify[0]'` | A short burst of 403s while CloudFront propagates |

Secrets ignore later Terraform changes (`ignore_changes = [secret_string]`), so a manual
rotation is not rolled back by the next apply. To roll:

```bash
aws ecs update-service --cluster <name_prefix> --service <api service> --force-new-deployment
aws ecs update-service --cluster <name_prefix> --service <worker service> --force-new-deployment
```

## Least-privilege database role

By default the api and worker connect as the RDS master user (`lms_admin`), so a compromised
task has DDL rights. The recommended post-deploy step is a non-master application role with
data rights only, while migrations keep the master user. It is not automated in Terraform: the
role lives inside Postgres, and Terraform would need a network path into the private database.

**1. Create the role.** Connect as the master user from inside the VPC (a bastion, an SSM
session or a one-off task) with `sslmode=require`, using the password from the RDS-managed
secret:

```bash
aws rds describe-db-instances --db-instance-identifier <name_prefix>-db \
  --query 'DBInstances[0].[Endpoint.Address,MasterUserSecret.SecretArn]' --output text
```

Generate the role's password (`openssl rand -base64 33 | tr -d '/+='`), then in the `lms`
database:

```sql
CREATE ROLE lms_app LOGIN PASSWORD '<generated password>';
GRANT CONNECT ON DATABASE lms TO lms_app;
GRANT USAGE ON SCHEMA public TO lms_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lms_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO lms_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lms_app;

-- Objects later migrations create (they run as lms_admin).
ALTER DEFAULT PRIVILEGES FOR ROLE lms_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lms_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lms_admin IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO lms_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lms_admin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO lms_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

The application needs no DDL at run time, including `SET CONSTRAINTS ... DEFERRED` (a
transaction setting, not DDL). Check: `SET ROLE lms_app; SELECT count(*) FROM users;` works
and `CREATE TABLE t (x int);` fails.

**2. Store its credentials** as a second secret, encrypted with the deployment's key, in the
RDS shape:

```bash
aws secretsmanager create-secret --name <name_prefix>/db-app \
  --kms-key-id alias/<name_prefix> \
  --secret-string '{"username":"lms_app","password":"<generated password>"}'
```

**3. Point the api and worker at it** in `terraform.tfvars` and deploy:

```hcl
app_db_secret_arn = "arn:aws:secretsmanager:<region>:<account>:secret:<name_prefix>/db-app-XXXXXX"
app_db_username   = "lms_app"
```

The migrate and admin tasks keep the master secret. Keep `migrate_on_boot = false`: with it
on, the API would try to migrate as `lms_app` and fail.

## Scaling

| What | How |
| --- | --- |
| API | `api_min_count`, `api_max_count`; CPU target 60%. Watch database connections: `DB_POOL_MAX` times API and worker tasks must stay under the instance's limit |
| Worker | `worker_min_count`, `worker_max_count`. Concurrency per task: 8 for `notify`, 4 for each other queue |
| Web | `web_min_count`, `web_max_count` |
| Database | Instance class (`db_instance_class`), storage autoscaling |
| Redis | Node type (`cache_node_type`); memory is the limit (noeviction) |
| Video | Not here: EVS serves manifests and segments |

The heaviest LMS requests are checkout start and fulfilment (one transaction with every
bundle course, the coupon, the invoice and the notification), the admin overview (aggregates
over a date range of up to 366 days) and the orders CSV export (rate limited to 10 per 10
minutes).

## Routine checks

- Weekly: `/admin/orders` filtered by status PENDING older than a day; the grading queue age;
  open reports in `/admin/moderation`; the failed-jobs alarm history.
- Monthly: compare gateway payouts with paid orders per currency (the orders CSV); review
  staff roles in `/admin/staff` and the audit trail for `user.role_change`.
- Before a release: `make test-integration`, `make test-matrix`, `make tf-validate`.
