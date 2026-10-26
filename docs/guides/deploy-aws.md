# Deploy to AWS

This guide deploys Euron Open LMS to an AWS account with the Terraform in
[`infra/terraform`](../../infra/terraform). Two environments ship ready to use:

| Environment | Directory | Shape |
| --- | --- | --- |
| `aws-dev` | [`envs/aws-dev`](../../infra/terraform/envs/aws-dev/main.tf) | A full, cheaper copy of production: 2 AZs, one NAT, single-AZ database, one Redis node, one task per service, no deletion protection, no CDN by default |
| `aws-prod` | [`envs/aws-prod`](../../infra/terraform/envs/aws-prod/main.tf) | 3 AZs with a NAT per AZ, Multi-AZ database, two Redis nodes with failover, at least two tasks per service, deletion protection, CloudFront and WAF, a year of logs |

Both call one module, [`modules/deployment`](../../infra/terraform/modules/deployment/main.tf).
What gets built is in [HLD.md](../architecture/HLD.md#deployed-shape-aws) and
[ADR 0009](../architecture/adr/0009-fargate-behind-one-alb.md): one host, one Application
Load Balancer sending `/api/*` and `/up` to the API service and everything else to the web
service, a worker with no inbound traffic, RDS PostgreSQL 16, ElastiCache Redis, a private
S3 bucket, SES, Secrets Manager and KMS.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Terraform 1.10 or newer | `required_version = ">= 1.10.0"`; the repository pins 1.16.6 for its containers |
| Docker with `buildx` | `make aws-deploy` builds and pushes the images |
| AWS CLI v2 and `python3` | Used by [`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh) and [`scripts/aws-run-task.sh`](../../scripts/aws-run-task.sh) |
| Credentials for the target account | Enough to create VPC, ECS, ECR, RDS, ElastiCache, S3, KMS, Secrets Manager, SES, ACM, Route53, CloudFront, WAF, IAM and CloudWatch resources |
| A domain | One host serves everything, for example `learn.example.com` |
| DNS | A Route53 hosted zone (`route53_zone_id`: certificates and records are created for you), or an existing ACM certificate (`certificate_arn`) and records you publish by hand. The CDN needs the zone |
| SES production access | New accounts are in the SES sandbox and can only send to verified addresses. Request production access before real learners sign up, or verification emails and receipts will not arrive |
| Optional: Stripe and/or Razorpay accounts | [payments.md](payments.md) |
| Optional: a euron-video-system deployment | [video-with-evs.md](video-with-evs.md) |

### Mail domain

The [email module](../../infra/terraform/modules/email/main.tf) creates an SES domain
identity for `mail_domain` (default: `domain`), a configuration set, and a custom MAIL FROM
subdomain. With a Route53 zone it writes the DKIM CNAMEs, the MAIL FROM MX and SPF records and
a DMARC record (policy from `dmarc_policy`). Without a zone, publish the records from the
output `mail_dns_records`; the identity stays pending until DKIM verifies.

## 1. Configure the environment

```bash
cd infra/terraform/envs/aws-dev
cp terraform.tfvars.example terraform.tfvars
```

Edit the copy ([`terraform.tfvars.example`](../../infra/terraform/envs/aws-dev/terraform.tfvars.example)):

| Variable | Notes |
| --- | --- |
| `region` | The deployment region; `aws-deploy.sh` reads it from this file |
| `name_prefix` | Prefix for every resource. The media bucket name derives from it, so make it globally unique |
| `domain` | The one public host (the web app, `/api/*` and the webhooks) |
| `route53_zone_id` or `certificate_arn` | See Prerequisites |
| `mail_domain` | Optional, defaults to `domain` |
| `product_name` | Default `Euron Open LMS`; the academy name itself is set later in `/admin/settings` |
| `alarm_email` | Optional; subscribes an address to the alarm topic (confirm the email SNS sends) |
| `enable_cdn` | `false` in aws-dev, `true` in aws-prod. With it on, CloudFront adds a secret `X-Origin-Verify` header and the load balancer refuses requests without it |
| `cpu_architecture` | `X86_64` (default) or `ARM64` (Graviton; the deploy script builds `linux/arm64` to match) |
| `enable_stripe`, `stripe_publishable_key` | Stripe on; the secret halves go to `<name_prefix>/payments` (section 3) |
| `enable_razorpay`, `razorpay_key_id` | Razorpay on; same |
| `evs_base_url`, `video_origins` | euron-video-system: its API origin, and the origins the CSP must allow for video (default: the origin of `evs_base_url`). The keys go to `<name_prefix>/evs` |
| `openai_api_key` or `create_openai_secret`, `ai_provider` | Optional AI (quiz drafts, grading suggestions, polish). Without a key `AI_PROVIDER` becomes `none` and the AI buttons are hidden |
| `media_cors_extra_origins` | Extra bucket CORS origins, for example `["http://localhost:3530"]` for [local-with-aws.md](local-with-aws.md) |
| `api_extra_environment` | Extra API and worker environment, merged over the module's |
| `app_db_secret_arn`, `app_db_username` | Optional least-privilege database role, created after the first deploy ([operations.md](operations.md#least-privilege-database-role)) |
| `db_instance_class`, `cache_node_type` | Sizes (below) |

Secrets can also be passed as sensitive variables (`stripe_secret_key`,
`stripe_webhook_secret`, `razorpay_key_secret`, `razorpay_webhook_secret`,
`evs_playback_key`, `evs_read_key`, `evs_webhook_secret`), but then they land in Terraform
state. The recommended path is to leave them unset and replace the `set-me` placeholders by
hand after the first apply (section 3). `*.tfvars` files are git-ignored.

### Remote state

State contains generated secrets (JWT and refresh signing keys, the TOTP key, the Redis AUTH
token, the CloudFront origin header) and anything you passed as a variable. For anything
shared, copy [`backend.tf.example`](../../infra/terraform/envs/aws-dev/backend.tf.example) to
`backend.tf` and point it at a private, versioned, encrypted S3 bucket.

## 2. Deploy

From the repository root:

```bash
make aws-deploy ENV=aws-dev
```

`TAG` defaults to the short commit hash. [`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh)
runs six steps:

1. `terraform apply -target=module.lms.module.ecr`: the api and web image repositories
   (immutable tags, scan on push).
2. Build the api and web images with `docker buildx` for the platform matching
   `cpu_architecture`, tag them with `TAG` and push.
3. `terraform apply -target=module.lms.module.migrate`: what the migration task needs
   (network, database, the task definition).
4. Run the `migrate` one-off task and wait for exit 0
   ([`scripts/aws-run-task.sh`](../../scripts/aws-run-task.sh)).
5. `terraform apply` for everything else: cache, edge, CDN, the api, worker and web
   services, observability.
6. `aws ecs wait services-stable`, then print the app URL, the **webhook URLs**, and the
   secrets that still hold `set-me` placeholders.

```
Webhook endpoints (register each one you use in that provider's dashboard):
  evs       https://learn.example.com/api/webhooks/evs
  razorpay  https://learn.example.com/api/webhooks/razorpay
  stripe    https://learn.example.com/api/webhooks/stripe
```

The same values are always available with `terraform output webhook_urls`,
`payments_secret_name` and `evs_secret_name`.

### Without a Route53 zone

Pass `certificate_arn`, then publish by hand the certificate validation records (output
`certificate_validation_records`), a CNAME or alias from `domain` to
`load_balancer_dns_name`, and the SES records (`mail_dns_records`).

## 3. Replace the `set-me` placeholders

With `enable_stripe` or `enable_razorpay`, Terraform creates `<name_prefix>/payments` with
all four keys set to `set-me`; with `evs_base_url`, `<name_prefix>/evs` with three. The API
treats a `set-me` secret key as not configured (Stripe and Razorpay will not sell, EVS
lectures will not play), but **webhook secrets are not checked for the placeholder**, so
replace every one before you take payments
([security.md](../architecture/security.md#known-limitations)).

Put the full JSON object (keep every key; a gateway that is off may stay `set-me`):

```bash
aws secretsmanager put-secret-value --secret-id <name_prefix>/payments --secret-string \
  '{"STRIPE_SECRET_KEY":"sk_live_...","STRIPE_WEBHOOK_SECRET":"whsec_...","RAZORPAY_KEY_SECRET":"...","RAZORPAY_WEBHOOK_SECRET":"..."}'

aws secretsmanager put-secret-value --secret-id <name_prefix>/evs --secret-string \
  '{"EVS_PLAYBACK_KEY":"evs_...","EVS_READ_KEY":"evs_...","EVS_WEBHOOK_SECRET":"whsec_..."}'

aws secretsmanager put-secret-value --secret-id <name_prefix>/openai --secret-string \
  '{"OPENAI_API_KEY":"sk-..."}'
```

ECS injects secrets at task start, so roll the api and worker afterwards:

```bash
aws ecs update-service --cluster <name_prefix> --service <api service> --force-new-deployment
aws ecs update-service --cluster <name_prefix> --service <worker service> --force-new-deployment
```

(`terraform output services` lists the service names.) Terraform never overwrites these
values later: the secret versions are `ignore_changes`.

Then register the webhooks:

- **Stripe**: an endpoint on `webhook_urls.stripe` with the events in
  [payments.md](payments.md#stripe); its signing secret is `STRIPE_WEBHOOK_SECRET`.
- **Razorpay**: a webhook on `webhook_urls.razorpay` with a secret you choose
  (`RAZORPAY_WEBHOOK_SECRET`) and the events in [payments.md](payments.md#razorpay).
- **EVS**: an endpoint on `webhook_urls.evs` for `video.ready` and `video.failed`; its
  signing secret is `EVS_WEBHOOK_SECRET` ([video-with-evs.md](video-with-evs.md)).

## 4. Create the first administrator

```bash
make aws-admin ENV=aws-dev EMAIL=you@example.com
```

This runs the `admin` one-off task (`node dist/cli.js admin:create --email ...`) and prints
its log. For a new email the command creates the account and emails a set-password link
through SES. For an existing account it only promotes it to ADMIN (and activates and
verifies it); its password is never changed. It never prints a password, because the
task's stdout is kept in CloudWatch Logs (`/open-lms/<name_prefix>/admin`); do not pass
`--print-password` here. If the link cannot be emailed the command creates nothing, prints
the reason and exits non-zero.

Before running it, the SES domain identity must be DKIM-verified, and while the account is
in the SES sandbox the recipient address must be verified too
(`aws sesv2 create-email-identity --email-identity you@example.com`).

Then open the link, set a password, sign in at `https://<domain>/admin`, turn on two-factor
sign-in, and in `/admin/settings` set the academy name, currencies, gateway routing, tax
and the seller details printed on invoices ([configuration.md](configuration.md#academy-settings)).
Give staff roles in `/admin/staff` (INSTRUCTOR, SUPPORT, FINANCE, ADMIN).

## Sizing

From the env files and the module defaults:

| Setting | aws-dev | aws-prod |
| --- | --- | --- |
| Availability zones, NAT | 2, one shared | 3, one per AZ |
| Interface endpoints | no | yes |
| CloudFront + WAF | off | on (managed rule sets, 2000 requests per IP per 5 minutes) |
| Database | `db.t4g.small`, single-AZ, 3 days of backups | `db.t4g.medium`, Multi-AZ, 14 days |
| Database storage | 20 GiB gp3, autoscaling to 100 GiB | same defaults |
| Redis | `cache.t4g.small`, 1 node, 1 day of snapshots | `cache.m7g.large`, 2 nodes with failover, 7 days |
| api / worker / web tasks | 1 to 2 / 1 / 1 to 2 | 2 to 10 / 2 to 6 / 2 to 6 |
| Task size | api and worker 512 CPU units, 1024 MiB; web 256, 512 | same |
| Deletion protection | off | on |
| KMS deletion window, secret recovery window | 7 days, 0 | 30 days, 30 |
| Log retention | 14 days | 365 days |

Autoscaling tracks 60% average CPU. Each API and worker process opens at most `DB_POOL_MAX`
(10) connections; the database alarm fires at 80% of 200. Video bandwidth is EVS's, not the
LMS's.

## Cost notes

The largest fixed costs are the NAT gateways, the database (Multi-AZ doubles it), the Redis
nodes, the load balancer, and in aws-prod the interface endpoints and CloudFront plus WAF.
Media storage, SES and the AI provider are usage-based; gateway fees are charged by Stripe
and Razorpay. Check current pricing for your region before choosing sizes.

## Updating

```bash
make aws-deploy ENV=aws-prod
```

Migrations run before the new task definitions roll out, so they must be compatible with the
code still running (add first, drop in a later release). Services deploy with a circuit
breaker and automatic rollback. `make aws-migrate ENV=...` runs only the migrations,
`make aws-plan ENV=...` only a plan.

### Rolling back

Image tags are immutable, so earlier images remain in ECR (within the lifecycle limit). For a
pure rollback apply the earlier tag without rebuilding:

```bash
terraform -chdir=infra/terraform/envs/aws-prod apply -var image_tag=<earlier-tag>
```

Migrations are forward-only: a rollback target must work with the current schema.

## Tearing down

```bash
terraform -chdir=infra/terraform/envs/aws-dev destroy
```

- aws-dev: the database is destroyed without a final snapshot, the bucket and repositories
  are emptied, secrets are deleted at once.
- aws-prod: the load balancer and database refuse deletion and a final snapshot
  `<name_prefix>-db-final` is taken. Set `deletion_protection = false`, apply, empty what
  must go, then destroy. Orders and invoices are financial records: export what you must
  keep first.

## Next steps

- [operations.md](operations.md): jobs, reconciliation, backups, rotation, scaling
- [payments.md](payments.md), [video-with-evs.md](video-with-evs.md)
- [security.md](../architecture/security.md) and its known limitations
