# ADR 0002: Relational schema, timestamptz(3) and ULID keys

## Status

Accepted.

## Context

An LMS is relational and full of rules that must hold under concurrency: one enrollment
per learner and course, one open quiz attempt per learner and quiz, one review per
learner and course, one certificate per learner and course, one active price per item and
currency, one live subscription per learner, one invoice per order. Lists are paginated by
time, so the time column is part of every cursor; a JavaScript `Date` holds milliseconds,
while PostgreSQL `timestamptz` defaults to microseconds.

## Decision

- PostgreSQL 16 with a relational schema in plain SQL migrations
  ([`db/migrations/0001_init.sql`](../../../db/migrations/0001_init.sql)) applied by a
  forward-only, checksummed runner under an advisory lock ([`db/migrate.ts`](../../../db/migrate.ts)).
  JSONB only for free-form or point-in-time data: question `options`, quiz attempt
  `snapshot` and `answers`, assignment `rubric`, submission `scores` and `ai_suggestion`,
  order `tax` and `billing`, invoice `seller`, `buyer`, `lines`, `tax`, price
  `gateway_refs`, webhook `payload`, notification `data`, `settings`.
- Rules are constraints: composite primary keys on link tables, `UNIQUE (user_id,
  course_id)` on enrollments and certificates, the partial unique indexes
  `quiz_attempts_one_open_idx`, `subscriptions_one_live_idx`, `prices_one_time_key`,
  `prices_recurring_key`, `orders_gateway_ref_key`, `invoices_order_key`, the CHECK on
  order totals, deferrable unique positions in the curriculum.
- Every timestamp is `timestamptz(3)`, and the API runs with `TZ=UTC` (set first in
  [`index.ts`](../../../apps/api/src/index.ts), [`worker.ts`](../../../apps/api/src/worker.ts),
  [`cli.ts`](../../../apps/api/src/cli.ts)). A cursor built from a `Date` equals the
  stored value.
- Primary keys are ULIDs stored as `text`, from a monotonic factory
  ([`core/ids.ts`](../../../apps/api/src/core/ids.ts)).
- Enums are PostgreSQL enum types; `citext` for emails, usernames, slugs and coupon codes;
  generated `tsvector` and `pg_trgm` for search.
- Runtime queries use Kysely with generated types ([`db/types.ts`](../../../apps/api/src/db/types.ts)).

## Consequences

Positive:

- Races resolve in the database: two attempt starts, two submits, two plan checkouts or two
  certificate issues become a unique violation or `ON CONFLICT DO NOTHING`, then a re-read
  or a 409.
- Cursor comparisons are exact without casts.
- Ids reveal no volumes and exist before insert.

Trade-offs:

- Millisecond precision: rows in the same millisecond are ordered by id, monotonic only
  within one process.
- Text ULIDs are larger than integers in indexes.

## Alternatives considered

- **A document store.** Pushes uniqueness and money arithmetic into application code.
- **Microsecond timestamps with text cursors everywhere.** Also exact (see
  `repositories/keyset.ts`), but every cursor would need that care.
- **UUIDv4 or bigserial.** v4 does not sort by time; bigserial reveals order volumes.
