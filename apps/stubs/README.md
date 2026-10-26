# @open-lms/stubs

Local stand-ins for every third party the LMS talks to: Stripe, Razorpay, an
OpenAI-compatible model and the video service (EVS). One dependency-free Node script
(`node:http`, `node:crypto`), state in memory, port 5119.

The API runs its real client code against it; only the base URLs differ from production.
A production API pointed at a stub base URL logs a warning at every boot (`productionWarnings` in apps/api/src/core/config.ts), and an admin sees the gateway mode as "stub" in Settings, Integrations.

```bash
PORT=5119 node apps/stubs/server.mjs        # or: pnpm --filter @open-lms/stubs start
pnpm --filter @open-lms/stubs test          # signature and flow tests
```

Point the API at it:

```bash
STRIPE_SECRET_KEY=sk_test_local STRIPE_WEBHOOK_SECRET=whsec_local_stub STRIPE_API_BASE=http://localhost:5119
RAZORPAY_KEY_ID=rzp_test_stub RAZORPAY_KEY_SECRET=rzp_stub_secret RAZORPAY_WEBHOOK_SECRET=rzp_stub_webhook_secret
RAZORPAY_API_BASE=http://localhost:5119 RAZORPAY_CHECKOUT_SCRIPT_URL=http://localhost:5119/stub/razorpay/checkout.js
AI_PROVIDER=stub AI_STUB_URL=http://localhost:5119
EVS_BASE_URL=http://localhost:5119 EVS_PLAYBACK_KEY=evs_local EVS_WEBHOOK_SECRET=evs_stub_webhook_secret
```

## Configuration

| Variable | Default | Used for |
| --- | --- | --- |
| `PORT` | `5119` | listen port |
| `STUB_PUBLIC_URL` | `http://localhost:$PORT` | URLs handed to browsers (hosted checkout, HLS manifests) |
| `STRIPE_SECRET_KEY` | any `sk_...` accepted | when set, the Bearer key must equal it |
| `STRIPE_WEBHOOK_SECRET` | `whsec_local_stub` | signs Stripe webhooks |
| `STUB_WEBHOOK_TARGET` | `http://api:5026/api/webhooks/stripe` | where Stripe webhooks go |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | `rzp_test_stub`, `rzp_stub_secret` | Basic auth, and the Checkout.js signature |
| `RAZORPAY_WEBHOOK_SECRET` | `rzp_stub_webhook_secret` | signs Razorpay webhooks |
| `STUB_RAZORPAY_WEBHOOK_TARGET` | `http://api:5026/api/webhooks/razorpay` | where Razorpay webhooks go |
| `EVS_PLAYBACK_KEY`, `EVS_READ_KEY` | any key accepted | when set, the Bearer key must be one of them |
| `EVS_WEBHOOK_SECRET` | `evs_stub_webhook_secret` | signs EVS webhooks |
| `STUB_EVS_WEBHOOK_TARGET` | `http://api:5026/api/webhooks/evs` | where EVS webhooks go |

Tests import `startStubs({ port: 0, config })` from `server.mjs`; the returned `config` is
mutable (point webhooks at a server that started later) and `state` exposes the
in-memory objects.

## Signatures

| Gateway | Header | Value |
| --- | --- | --- |
| Stripe | `Stripe-Signature` | `t=<unix>,v1=<hex HMAC-SHA256(STRIPE_WEBHOOK_SECRET, "<t>.<raw body>")>` |
| Razorpay webhook | `X-Razorpay-Signature`, `X-Razorpay-Event-Id` | hex HMAC-SHA256(RAZORPAY_WEBHOOK_SECRET, raw body) |
| Razorpay Checkout.js | `razorpay_signature` in the handler payload | hex HMAC-SHA256(key_secret, `order_id\|payment_id`), or `payment_id\|subscription_id` |
| EVS | `EVS-Signature` | same scheme as Stripe's, with EVS_WEBHOOK_SECRET |

The signing helpers are exported (`stripeSignature`, `razorpayWebhookSignature`,
`razorpayPaymentSignature`, `evsSignature`) so tests can craft their own events.

## Endpoints

Every `/stub/...` route answers CORS `*` (the browser calls them from the web app).
Simulation endpoints take an optional `deliver` (`sync`, the default: webhooks are
delivered before the response; `async`; `none`: no webhooks), in the JSON body or as
`?deliver=` on the hosted page buttons. `GET /stub/webhooks` lists the last deliveries.

### Stripe (Bearer secret key, form-encoded bodies, Stripe error shapes)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/customers` | `email`, `name`, `metadata` |
| POST | `/v1/prices` | `currency`, `unit_amount`, `recurring[interval]`, `product_data[name]` |
| POST | `/v1/coupons` | `amount_off` + `currency`, or `percent_off`; `duration` |
| POST | `/v1/checkout/sessions` | `mode` payment or subscription, `line_items[n][price_data]...` or `line_items[0][price]`, `success_url`, `cancel_url`, `metadata`, `subscription_data[metadata]`, `subscription_data[trial_period_days]`, `discounts[0][coupon]`, `expires_at`; returns `url` = the hosted page |
| GET | `/v1/checkout/sessions/:id` | status `open`, `complete` or `expired`; `payment_status`; `amount_total` |
| POST | `/v1/checkout/sessions/:id/expire` | sends `checkout.session.expired` |
| GET | `/v1/subscriptions/:id` | period on the subscription and on `items.data[0]` |
| POST | `/v1/subscriptions/:id` | `cancel_at_period_end=true\|false`; sends `customer.subscription.updated` |
| DELETE | `/v1/subscriptions/:id` | cancel now; sends `customer.subscription.deleted` |
| GET | `/v1/invoices/:id`, `/v1/payment_intents/:id` | |
| POST | `/v1/refunds` | `payment_intent`, `amount`, `metadata`; succeeds at once and sends `charge.refunded` + `refund.updated`. An amount ending in 13 minor units is declined: `pending`, then `refund.updated` with status `failed` |
| GET | `/stub/stripe/checkout/:sessionId` | hosted page with Pay / Fail / Cancel |
| POST | `/stub/stripe/checkout/:sessionId/pay` | completes the session; payment mode sends `checkout.session.completed`; subscription mode also creates the subscription and sends `customer.subscription.created` and `invoice.paid` (`billing_reason=subscription_create`). Then 303 to `success_url` (`{CHECKOUT_SESSION_ID}` replaced), or JSON `{ session, redirect }` with `Accept: application/json` |
| POST | `/stub/stripe/checkout/:sessionId/fail` | sends `checkout.session.async_payment_failed`, then 303 to `cancel_url` |
| POST | `/stub/stripe/checkout/:sessionId/cancel` | 303 to `cancel_url`, no event |
| POST | `/stub/stripe/subscriptions/:id/renew` | next period, `invoice.paid` (`subscription_cycle`) and `customer.subscription.updated`; `{ amount }` overrides the charge |
| POST | `/stub/stripe/subscriptions/:id/fail` | `past_due`, `invoice.payment_failed` and `customer.subscription.updated` |
| POST | `/stub/stripe/subscriptions/:id/end` | `customer.subscription.deleted` (a period end after a scheduled cancel) |

### Razorpay (Basic `key_id:key_secret`, JSON bodies, Razorpay error shapes)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/orders` | `amount` (at least 100), `currency`, `receipt`, `notes` |
| GET | `/v1/orders/:id`, `/v1/orders/:id/payments` | |
| GET | `/v1/payments/:id` | |
| POST | `/v1/payments/:id/capture` | |
| POST | `/v1/payments/:id/refund` | `amount`, `notes`; `processed` at once and sends `refund.processed` (amounts ending in 13 fail: `refund.failed`) |
| POST | `/v1/plans` | `period` monthly or yearly, `interval`, `item { name, amount, currency }` |
| POST | `/v1/subscriptions` | `plan_id`, `total_count`, `notes`, `start_at` (a trial) |
| GET | `/v1/subscriptions/:id` | |
| POST | `/v1/subscriptions/:id/cancel` | `cancel_at_cycle_end` 1 (scheduled) or 0 (now; sends `subscription.cancelled`) |
| GET | `/stub/razorpay/checkout.js` | defines `window.Razorpay(options)` with `open()`, `on("payment.failed", fn)`, `close()`; the overlay's Pay calls `/stub/razorpay/pay` and then `options.handler(payload)`; Fail calls `/stub/razorpay/fail` and the `payment.failed` listeners (else `options.modal.ondismiss`) |
| POST | `/stub/razorpay/pay` | `{ order_id }`: captures, sends `payment.captured` + `order.paid`. `{ subscription_id }`: activates, sends `subscription.activated` + `subscription.charged` (or `subscription.authenticated` for a trial). Returns the handler payload with a real signature |
| POST | `/stub/razorpay/fail` | sends `payment.failed`; returns Checkout.js's failure payload |
| POST | `/stub/razorpay/subscriptions/:id/renew` | next period, `subscription.charged`; `{ amount }` overrides |
| POST | `/stub/razorpay/subscriptions/:id/fail` | `pending`, `subscription.pending` |
| POST | `/stub/razorpay/subscriptions/:id/end` | `cancelled`, `subscription.cancelled` |

### OpenAI-compatible

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/chat/completions` | picks the answer by `response_format.json_schema.name`: `quiz_questions` (exactly the requested count, cycling the requested kinds, terms taken from the lesson text), `grade_suggestion` (half marks, rounded up, for every `id=` criterion in the rubric), `polish` (the text between `<text>` tags, tidied). `[[ai:fail]]` anywhere answers 500 |

### EVS (Bearer key)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/videos/:id/playback-sessions` | 201 `{ sessionId, expiresAt, manifestUrl, thumbnailsUrl, posterUrl, watermark }`; ids starting `missing` are 404, `processing...` and `vid_processing` 422 |
| GET | `/v1/videos?q=&page=&limit=` | `{ data, pagination }` over three fixed videos |
| GET | `/stub/evs/play/:id/master.m3u8?token=` | a one-rendition HLS master, then `media.m3u8` and three 2-second MPEG-TS segments (`assets/hls`, stored as `.bin`); a bad or expired token is 403 |
| POST | `/stub/evs/videos/:id/ready`, `/stub/evs/videos/:id/failed` | sends a signed `video.ready` (`{ durationSeconds }`) or `video.failed` (`{ error }`) |

### Health

`GET /` and `GET /health` answer `{ ok: true }`.
