# ADR 0014: One fulfilment path for webhooks, returns and reconciliation

## Status

Accepted.

## Context

The LMS learns that a payment succeeded in several ways: the gateway's webhook (which can
be late, duplicated or lost), the Razorpay Checkout.js success callback forwarded by the
browser, the Stripe return page asking Stripe, a reconcile job asking about old pending
orders, a first subscription charge whose checkout event was lost, and zero-total orders.
Any two can happen at the same moment. The system this one replaces processed webhooks
twice and trusted the amount in them.

## Decision

- `fulfilOrder(orderId, capture, source)` in
  [`services/payments/fulfilment.service.ts`](../../../apps/api/src/services/payments/fulfilment.service.ts)
  is the only function that turns money into access. Every path above calls it.
- In one transaction it locks the order row, returns `ALREADY_PAID` if settled, refuses a
  cancelled order (flagged `PAID_AFTER_CANCEL`), checks the captured amount and currency
  against the order (`AMOUNT_MISMATCH` is flagged and audited, nothing granted), moves to
  PAID with a conditional update, grants enrollments or activates the subscription, counts
  the coupon, issues the invoice and notifies; the PDF and receipt follow after commit.
- The state machine is pure ([`domain/orders.ts`](../../../apps/api/src/domain/orders.ts)):
  every move is a conditional update from the allowed sources.
- Webhooks are deduplicated before they reach it (`payment_events (gateway, event_id)`
  unique), and their order is found by the gateway's reference, never by a browser value.
- The browser is never trusted on its own: the Razorpay payload's signature is verified and
  the payment fetched; the Stripe return only triggers a server-side status fetch.

Details: [payments.md](../payments.md).

## Consequences

Positive:

- A race between paths is serialised by the row lock; the loser is a no-op.
- Lost webhooks are covered by three independent paths.

Trade-offs:

- Fulfilment is one large transaction (enrollments for every bundle course, coupon,
  invoice, notification).
- An amount mismatch stays PENDING until staff act; the reconcile job re-checks it on every
  run.

## Alternatives considered

- **Webhook-only fulfilment.** Simplest, but a lost or slow webhook leaves a paying learner
  waiting with no way forward.
- **Fulfil on the browser's return.** The browser's word is not proof of payment.
