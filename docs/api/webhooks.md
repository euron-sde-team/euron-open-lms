# Inbound webhooks

Three endpoints receive events from outside, all on the API rule of the load balancer
(`terraform output webhook_urls`):

| Endpoint | From | Verified with |
| --- | --- | --- |
| `POST /api/webhooks/stripe` | Stripe | `STRIPE_WEBHOOK_SECRET` |
| `POST /api/webhooks/razorpay` | Razorpay | `RAZORPAY_WEBHOOK_SECRET` |
| `POST /api/webhooks/evs` | euron-video-system | `EVS_WEBHOOK_SECRET` |

They are mounted before the JSON parser with `express.raw` (any content type, at most 1 MB),
so the signature is computed over the exact bytes received
([`apps/api/src/app.ts`](../../apps/api/src/app.ts),
[`apps/api/src/routes/index.ts`](../../apps/api/src/routes/index.ts) `WEBHOOK_MOUNTS`). No
session, no CORS: the signature is the only authentication. Behind CloudFront, `/api/*` is
forwarded uncached with the body untouched, and the WAF's common rule set skips
`/api/webhooks/*` (the known-bad-inputs rules and the rate limit still apply).

> A webhook secret equal to the Terraform placeholder `set-me` is accepted as a key today.
> Replace it before enabling the integration ([security.md](../architecture/security.md#known-limitations)).

## Stripe

**Headers.** `Stripe-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>...]`.

**Signature.** `v1 = hex(HMAC-SHA256(STRIPE_WEBHOOK_SECRET, "<t>.<raw body>"))`. Any of the
`v1` values may match (Stripe sends two while a secret is rolled); comparison is constant
time; `|now - t|` must be at most 300 seconds
([`apps/api/src/services/payments/stripe.ts`](../../apps/api/src/services/payments/stripe.ts),
`verifyStripeSignature`).

**Events handled** (`normalizeStripeEvent`):

| Event | Action |
| --- | --- |
| `checkout.session.completed`, `checkout.session.async_payment_succeeded` | When `payment_status` is `paid` or `no_payment_required`: fulfil the order whose `gateway_ref` is the session id (or whose id is in `metadata.order_id` / `client_reference_id`), with `amount_total` and `currency` checked against it |
| `checkout.session.async_payment_failed` | PENDING order to FAILED |
| `checkout.session.expired` | PENDING order to EXPIRED |
| `customer.subscription.created`, `.updated`, `.resumed`, `.paused` | Subscription status, period, trial, `cancel_at_period_end` (found by id or `metadata.subscription_id`) |
| `customer.subscription.deleted` | Subscription CANCELED, access ends |
| `invoice.paid` | `billing_reason = subscription_create`: the first payment (fulfils the first order if the checkout event was lost); otherwise a renewal order with its own invoice, amount checked against the subscription |
| `invoice.payment_failed` | Subscription PAST_DUE |
| `charge.refunded`, `refund.created`, `refund.updated`, `charge.refund.updated` | Settle the refund (succeeded or failed) found by refund id or `metadata.refund_id` |

**Idempotency.** The event id (`evt_...`) is the key of `payment_events (gateway, event_id)`.

## Razorpay

**Headers.** `X-Razorpay-Signature: <hex>`, `X-Razorpay-Event-Id: <id>`.

**Signature.** `hex(HMAC-SHA256(RAZORPAY_WEBHOOK_SECRET, raw body))`, constant time
([`apps/api/src/services/payments/razorpay.ts`](../../apps/api/src/services/payments/razorpay.ts),
`verifyRazorpayWebhookSignature`). Razorpay sends no timestamp; replays are stopped by
deduplication.

**Events handled** (`normalizeRazorpayEvent`):

| Event | Action |
| --- | --- |
| `payment.captured` | Fulfil the order whose `gateway_ref` is `payment.order_id` (or `notes.order_id`), with the payment's amount and currency checked |
| `order.paid` | Same, from the order entity |
| `payment.failed` | PENDING order to FAILED (a later capture can still pay it) |
| `subscription.authenticated`, `.activated`, `.updated`, `.resumed` | Subscription status and period (`authenticated` reads as a trial) |
| `subscription.charged` | First payment (`paid_count <= 1`) or a renewal |
| `subscription.pending`, `.halted` | PAST_DUE |
| `subscription.cancelled`, `.completed` | CANCELED, access ends |
| `refund.processed`, `refund.failed` | Settle the refund by id or `notes.refund_id` |

**Idempotency.** `X-Razorpay-Event-Id` is the key; when it is missing, `body_` plus the first
40 hex characters of the body's SHA-256.

## Responses and processing (Stripe and Razorpay)

[`apps/api/src/services/payments/webhook.service.ts`](../../apps/api/src/services/payments/webhook.service.ts):

| Situation | Status | Body |
| --- | --- | --- |
| Missing or wrong signature, missing secret, body not JSON, no event id | 400 | `{ received: false, error: "Invalid signature" }`. Nothing stored |
| Event seen before | 200 | `{ received: true, duplicate: true }`. Not processed again |
| Processed | 200 | `{ received: true, outcome }` |
| A business rule said no | 200 | `{ received: true, outcome: "REJECTED_<code>" }` (also `ORDER_NOT_FOUND`, `AMOUNT_MISMATCH`, `IGNORED_PAID`, ...) |
| Unexpected error (the database is down) | 500 | `{ received: false, error: "Processing failed; retry later" }`. The stored event is deleted so the gateway's retry is processed |

Every accepted event is stored in `payment_events` with its type, the order or subscription
it touched, the outcome and the payload **redacted** of card, bank, UPI, email, phone and
address data ([`redact.ts`](../../apps/api/src/services/payments/redact.ts)). The order page
in `/admin/orders/<id>` shows them as a timeline.

The amount in an event is never trusted: fulfilment compares it with the order
([architecture/payments.md](../architecture/payments.md#6-fulfilment)).

## euron-video-system

**Headers.** `EVS-Signature: t=<unix seconds>,v1=<hex>`. EVS also sends `EVS-Event-Id`,
`EVS-Event-Type` and `EVS-Delivery-Id`; the LMS does not need them.

**Signature.** `v1 = hex(HMAC-SHA256(EVS_WEBHOOK_SECRET, "<t>.<raw body>"))`, constant time,
300 seconds tolerance ([`apps/api/src/integrations/evs.ts`](../../apps/api/src/integrations/evs.ts),
`verifyWebhook`).

**Body.** The EVS envelope `{ id, type, createdAt, data }`.

**Events handled** ([`apps/api/src/services/evs.service.ts`](../../apps/api/src/services/evs.service.ts),
`handleWebhook`):

| Event | Action |
| --- | --- |
| `video.ready` | Every EVS lecture with `video_ref = data.videoId` becomes READY; a positive `data.durationSeconds` (capped at 360000) becomes the item duration and the course totals are recounted |
| `video.failed` | Those lectures become FAILED |
| anything else, or an unknown or malformed video id | No-op |

**Responses.**

| Situation | Status | Body |
| --- | --- | --- |
| `EVS_WEBHOOK_SECRET` unset | 503 | `EVS_WEBHOOK_NOT_CONFIGURED` |
| Bad signature | 400 | `BAD_SIGNATURE` |
| Body not JSON | 400 | `BAD_PAYLOAD` |
| Otherwise | 200 | `{ received: true, updated: <lectures changed> }` |

**Idempotency.** None stored and none needed: the handler sets state, so a redelivery writes
the same values. Subscribe only `video.ready` and `video.failed`.

## Testing locally

The stubs ([`apps/stubs/README.md`](../../apps/stubs/README.md)) send all three kinds,
signed with the same secrets the API verifies with; `GET http://localhost:5119/stub/webhooks`
lists the last deliveries. The signing helpers (`stripeSignature`,
`razorpayWebhookSignature`, `evsSignature`) are exported for tests. Against real Stripe from
a laptop, use `stripe listen --forward-to localhost:5026/api/webhooks/stripe`.
