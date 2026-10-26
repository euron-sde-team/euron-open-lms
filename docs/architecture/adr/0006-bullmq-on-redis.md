# ADR 0006: BullMQ on Redis for background jobs

## Status

Accepted.

## Context

Some work must not run on the request path or must run on a schedule: rendering invoice
and certificate PDFs, sending receipts and notification mail, re-encoding images, asking
the gateways about orders whose webhook never came, expiring subscriptions, expiring
uploads, lifting suspensions, recounting counters, purging deleted accounts. It needs
retries, concurrency limits and schedules that run once with several worker tasks.

## Decision

- BullMQ queues on the same Redis used for rate limits: `media`, `notify`, `invoices`,
  `certificates`, `billing`, `ai`, `maintenance`
  ([`jobs/registry.ts`](../../../apps/api/src/jobs/registry.ts)). A job's queue is the prefix
  of its name.
- Defaults: 5 attempts, exponential backoff from 5 s, the last 1000 completed and 5000
  failed jobs kept.
- A separate worker process on the same image, `node dist/worker.js`
  ([`worker.ts`](../../../apps/api/src/worker.ts)): concurrency 8 for `notify`, 4 for the
  others, per task.
- Repeatable jobs keyed by name and interval, registered by every worker on boot:
  reconcile pending orders 10 min, expire subscriptions 30 min, the mail sweep 5 min,
  expire uploads 30 min, lift suspensions 5 min, reconcile counters 6 h, purge accounts 6 h.
- Jobs are enqueued only after commit ([ADR 0007](0007-after-commit-effects.md)); payloads
  carry ids, never content.
- `JOBS_MODE=inline` runs handlers in-process after commit for the integration tests; the
  production guard refuses it.
- On AWS, ElastiCache runs with `maxmemory-policy noeviction`: an evicted job key is a lost
  job ([`infra/terraform/modules/cache/main.tf`](../../../infra/terraform/modules/cache/main.tf)).

## Consequences

Positive:

- One dependency for jobs and rate limits; retries for flaky gateways and mail.
- The worker scales separately from the API.

Trade-offs:

- Redis is stateful and must not evict; its memory is a capacity limit (an alarm fires at
  80%).
- Inline mode has no retries and no schedules.
- A failed-jobs alarm exists (from the worker log), but no queue-depth alarm.

## Alternatives considered

- **PostgreSQL as the queue.** One fewer service, but Redis is already needed for shared
  rate limits.
- **SQS plus a scheduler.** AWS-only and a second local emulation path.
- **In-process timers.** Would run once per API task and lose work on restart.
