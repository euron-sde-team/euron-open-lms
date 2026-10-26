# ADR 0001: One academy per deployment

## Status

Accepted.

## Context

Euron Open LMS is meant to be self-hosted by one organisation: a training company, a
university department, a professional body, a single creator. That operator sells its own
courses under its own name, with its own gateway accounts, tax setup and legal details on
its invoices.

A multi-tenant design (many academies in one database) would need a tenant key on every
row, every unique index and every cache and rate-limit key, tenant-scoped gateway
credentials and webhook routing, per-tenant invoice sequences and a super-operator plane
above the academies. Every query would carry a predicate that, forgotten once, leaks one
academy's learners or revenue to another.

## Decision

- One deployment serves exactly one academy. There is no tenant table and no `tenant_id`
  column ([`db/migrations/0001_init.sql`](../../../db/migrations/0001_init.sql)).
- The academy's configuration is one JSON document in `settings` (`key = 'academy'`):
  name, registration mode, currencies, gateway routing, tax rules, the seller block for
  invoices, learning thresholds, certificate signatory, analytics time zone
  ([`apps/api/src/services/settings.service.ts`](../../../apps/api/src/services/settings.service.ts)).
- Gateway, EVS and AI credentials are deployment configuration (environment and Secrets
  Manager), not data.
- Instructors are users with a platform role and per-course staff rows; they are not
  sub-tenants with their own catalog, payouts or settings.
- Several academies means several deployments.

## Consequences

Positive:

- No tenant predicate to forget; unique keys (emails, usernames, slugs, coupon codes,
  invoice numbers) are naturally per academy.
- Webhooks need no routing: one endpoint per gateway, one secret.
- Invoice series are simple and gap-free per year ([ADR 0018](0018-gap-free-invoice-numbering.md)).

Trade-offs:

- A host serving many small academies pays for one stack each (database, cache, NAT, load
  balancer).
- No shared learner identity across academies.
- No marketplace: revenue is the academy's; instructors are not paid out by the system.

## Alternatives considered

- **Multi-tenant with a tenant column.** Cheaper per academy for a hosted service, at the
  cost of a scoping rule on every query, key and job, for an audience that mostly runs one
  academy.
- **A marketplace (instructors as sellers).** Needs payouts, revenue shares, per-seller
  tax and refunds liability: a different product.
