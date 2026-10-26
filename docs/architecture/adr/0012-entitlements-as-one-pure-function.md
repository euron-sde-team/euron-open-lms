# ADR 0012: Course access decided by one pure function

## Status

Accepted.

## Context

Access to a course can come from many places: a free enrollment, a purchase, a bundle, an
admin grant with an end date, an all-access plan (trialing, active, in a grace period after
a failed renewal, cancelled but paid to the end of the period), and course staff. It can
end by expiry, revocation, a refund or the end of a subscription. The system this one
replaces checked access in many places with conditions that were effectively always true,
and let paid courses be enrolled in through the free-enroll endpoint.

## Decision

- `decideAccess(facts)` in [`domain/entitlements.ts`](../../../apps/api/src/domain/entitlements.ts)
  is the only decision. It is pure (no I/O) and its order is the policy: signed out; staff
  (and ADMIN, SUPPORT) always; inactive account; not published; the enrollment by its
  source (SUBSCRIPTION rows only while the plan unlocks, others until `valid_until`, unless
  revoked or refunded); an active plan for included courses; otherwise not enrolled.
- `services/access.service.ts` is the only code that loads the facts for it and turns the
  result into 404 (unpublished), `403 SIGN_IN_REQUIRED` or `403 COURSE_ACCESS_REQUIRED` with
  the reason. Every content route calls `requireCourseAccess` or `requireItemAccess`.
- Enrollments record why access exists and hold progress; they are not proof of access.
  Subscription access is never written: it is computed from the subscription row.
- Free previews are the one exception, applied after the decision, for preview lectures of
  published courses.
- Pages that list many courses (My Learning, the admin learner view) call `decideAccess`
  on batch-loaded facts, never a second implementation.

Details: [entitlements.md](../entitlements.md).

## Consequences

Positive:

- One place to read, test ([`test/unit/entitlements.test.ts`](../../../apps/api/test/unit/entitlements.test.ts))
  and change. A lapsed reason comes back with every denial, so the UI can explain it.
- Refunds, revokes, expiries and subscription changes take effect on the next request with
  no cleanup job.

Trade-offs:

- Every content request runs three small queries (staff role, enrollment with its order,
  subscription) plus the settings read.
- A rule that does not fit "facts in, decision out" (for example per-item drip schedules)
  would need new facts.

## Alternatives considered

- **Materialised access rows** (write an access row on every change). Faster reads, but
  every change path (refund, grace, expiry, revoke) must remember to update it.
- **Checks spread across services.** The defect being fixed.
