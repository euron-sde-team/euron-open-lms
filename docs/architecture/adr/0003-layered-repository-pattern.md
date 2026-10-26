# ADR 0003: Layered API with repositories

## Status

Accepted.

## Context

The same rules are reached from HTTP routes, background jobs, the CLI, the demo seed and
the tests: an enrollment is granted by checkout fulfilment, by free enroll, by an admin
grant and by the seed, and every path must keep the counter, the audit row and the
notification in the same transaction. Access, pricing, grading and completion rules must
be unit-testable without a database.

## Decision

The API ([`apps/api/src`](../../../apps/api/src)) is layered:

| Layer | Folder | Responsibility |
| --- | --- | --- |
| Routes | `routes/` | Mount points, auth middleware, rate limits ([`routes/index.ts`](../../../apps/api/src/routes/index.ts)) |
| Controllers | `controllers/` | Parse input with strict zod, call one service, shape the HTTP response |
| Services | `services/` | Business rules, transactions, effects; take an `Actor`, never a request ([`core/context.ts`](../../../apps/api/src/core/context.ts)) |
| Domain | `domain/` | Pure rules: entitlements, pricing, the order state machine, progress, quiz grading, rubrics, authoring checks, markdown, URLs, media rules, admin areas |
| Repositories | `repositories/` | Kysely queries; every method accepts an `Executor` (pool or transaction) |
| Presenters | `presenters/` | Rows to DTOs from `@open-lms/types`, field by field, batched |
| Integrations | `integrations/` | Storage, mail, Redis, EVS, AI providers |

Two cross-cutting services own a rule each: `access.service.ts` (who may open content)
and `enrollment.service.ts` (the only writer of enrollments).

## Consequences

Positive:

- One rule, one place, pinned by unit tests in [`apps/api/test/unit`](../../../apps/api/test/unit)
  (`entitlements.test.ts`, `pricing.test.ts`, `orders.test.ts`, `quiz.test.ts`,
  `progress.test.ts`, ...).
- Services run unchanged from jobs, the CLI and tests.
- Transactions span repositories by passing the executor.

Trade-offs:

- More files per feature; some indirection for simple reads.
- Presenters issue their own batched queries, so a response is several round trips.
- The layering is a convention: a few services run small queries inline.

## Alternatives considered

- **An ORM with active records.** Hides the queries the access and money rules depend on.
- **Fat controllers.** Rules would not be reusable from jobs and the seed.
