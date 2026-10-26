# ADR 0004: Keyset pagination everywhere

## Status

Accepted.

## Context

Order lists, the grading queue, notifications, Q&A, reviews, the audit trail, the catalog
and My Learning are read from the newest (or oldest) end and appended to constantly.
`OFFSET` pages slow down with depth and shift when rows are inserted; a total count on
every list is expensive and rarely needed.

## Decision

- Lists return `Page<T>` (`{ items, nextCursor }`), never a total. The repository asks for
  `limit + 1` rows; limit is 1 to 50, default 20
  ([`core/validate.ts`](../../../apps/api/src/core/validate.ts), [`core/cursor.ts`](../../../apps/api/src/core/cursor.ts)).
- Cursors are opaque base64url strings validated on decode (`400 INVALID_CURSOR`). Two
  encodings: [`core/cursor.ts`](../../../apps/api/src/core/cursor.ts) (`iso|id` from a
  `Date`, exact because columns are `timestamptz(3)`) and
  [`repositories/keyset.ts`](../../../apps/api/src/repositories/keyset.ts) (JSON arrays;
  the time cursor reads the column as exact UTC text).
- Comparisons are row values, `(created_at, id) < (cursor.at, cursor.id)`, served by
  composite and partial indexes (`orders_user_idx`, `assignment_submissions_queue_idx`,
  `notifications_inbox_idx`, `audit_log_recent_idx`, `courses_catalog_idx`, ...).
- Small bounded lists (categories, plans, one learner's submissions to one assignment) are
  plain arrays.

## Consequences

Positive:

- Constant-time pages at any depth; no skipped or repeated rows on time-ordered lists.
- No `COUNT(*)` on hot paths. The admin overview computes its numbers per range instead.

Trade-offs:

- No "page 7 of 12".
- Ranked catalog sorts (rating, price) page by score and id, which can shift if a score
  changes between pages.
- Two cursor modules to keep consistent.

## Alternatives considered

- **OFFSET/LIMIT.** Simple, slow at depth, unstable under inserts.
- **Server-side cursors.** Hold database resources between requests.
