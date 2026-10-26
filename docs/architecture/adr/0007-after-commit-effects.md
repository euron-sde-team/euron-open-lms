# ADR 0007: Side effects only after commit

## Status

Accepted.

## Context

A write usually has effects outside the database: render the invoice PDF, mail the
receipt, email a notification, render a certificate, re-encode an image. Doing them inside
the transaction risks announcing something that is then rolled back (a receipt for a
fulfilment that lost its race, a certificate PDF for a completion that did not commit).
Doing them by hand after every transaction is easy to forget, and a failing email must not
fail a payment that already happened.

## Decision

[`core/effects.ts`](../../../apps/api/src/core/effects.ts) provides an `Effects` buffer and
two runners:

```ts
return withTransaction(async (trx, fx) => {
  const invoice = await issueInvoice(paid, items, trx, { subscriptionId });
  await notify({ recipientId: order.user_id, type: "ORDER_PAID", ... }, fx, trx);
  fx.job("invoices.render", { invoiceId: invoice.id });
  fx.job("notify.receipt", { orderId: order.id });
  return { outcome: "FULFILLED", order: paid };
});
```

- `fx.job` and `fx.after(fn)` queue work; `flush()` runs it in order only after the
  transaction committed. `withEffects` gives the same contract without a transaction.
- Each effect is wrapped: an error is logged and the next effect still runs.
- Helpers that create effects take the caller's `fx` (`notify(input, fx, trx)`,
  `grantEnrollment(input, trx, fx)`, `markItemComplete(input, trx, fx)`), so they compose
  inside any transaction.
- The audit row is written inside the transaction, not as an effect.

## Consequences

Positive:

- No receipt, PDF or email for a rolled-back write; jobs always find their rows.

Trade-offs:

- At most once: a crash between commit and flush loses the effect. The `notify.email`
  sweep re-sends notification mail that was never claimed; a lost PDF render leaves
  `pdf_key` NULL and the download says it is still rendering until the job is enqueued again.
- One call (ending a refunded plan at the gateway) runs as `fx.after` and is retried by
  nothing if it fails.

## Alternatives considered

- **Transactional outbox.** At-least-once and crash-safe, at the cost of a table and a relay.
- **Effects inside the transaction.** Announces writes that may roll back.
