# Payments setup: Stripe and Razorpay

How to connect real Stripe and Razorpay accounts, which webhook events to subscribe, how to
test with their test modes, and how to set currencies, routing and tax. How payments work
inside the LMS is in [architecture/payments.md](../architecture/payments.md); the webhook
wire format is in [api/webhooks.md](../api/webhooks.md).

You can enable one gateway or both. Stripe takes any currency; Razorpay takes INR only
([`apps/api/src/services/payments/gateway.ts`](../../apps/api/src/services/payments/gateway.ts),
`RAZORPAY_CURRENCIES`). With neither configured, free courses and admin grants still work,
and the API logs that paid courses cannot be sold.

## Stripe

### Keys

From the Stripe dashboard (Developers, API keys), test mode first:

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_...` (later `sk_live_...`). A restricted key works if it may write Checkout Sessions, Customers, Prices, Coupons, Refunds and Subscriptions and read PaymentIntents and Invoices |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` (reported in `GET /api/meta`; Checkout is a redirect, so it is informational) |
| `STRIPE_WEBHOOK_SECRET` | The endpoint's signing secret, `whsec_...` |
| `STRIPE_API_BASE` | Leave unset (`https://api.stripe.com`) |

On AWS: `enable_stripe = true` and `stripe_publishable_key` in `terraform.tfvars`, the two
secrets in `<name_prefix>/payments` ([deploy-aws.md](deploy-aws.md#3-replace-the-set-me-placeholders)).
Locally: set them in `deploy/compose/.env` (they win over the stub defaults) and include
`STRIPE_API_BASE=https://api.stripe.com`.

### Webhook endpoint and events

Add an endpoint (Developers, Webhooks) on `https://<domain>/api/webhooks/stripe`
(`terraform output webhook_urls`) and subscribe exactly the events the API acts on
([`apps/api/src/services/payments/stripe.ts`](../../apps/api/src/services/payments/stripe.ts),
`normalizeStripeEvent`):

| Event | Used for |
| --- | --- |
| `checkout.session.completed` | Payment (one-time and the first subscription payment) |
| `checkout.session.async_payment_succeeded` | Delayed payment methods |
| `checkout.session.async_payment_failed` | Failed delayed payment |
| `checkout.session.expired` | Abandoned checkout, the order becomes EXPIRED |
| `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed` | Subscription status and period |
| `invoice.paid` | Renewals (and the first charge as a fallback) |
| `invoice.payment_failed` | A failed renewal: PAST_DUE |
| `charge.refunded`, `refund.created`, `refund.updated`, `charge.refund.updated` | Refund settlement |

Other events are stored and ignored, so subscribing more is harmless but noisy. Copy the
endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`. During a secret roll Stripe signs
with both secrets; the API accepts any matching `v1` value, so update the secret, roll the
services, then expire the old one.

For local development against real Stripe, forward events with the Stripe CLI:

```bash
stripe listen --forward-to localhost:5026/api/webhooks/stripe
```

and use the `whsec_...` it prints.

### Test cards

In test mode (from Stripe's testing documentation; check it for the current list):

| Card | Behaviour |
| --- | --- |
| `4242 4242 4242 4242` | Succeeds |
| `4000 0025 0000 3155` | Requires 3-D Secure authentication |
| `4000 0000 0000 9995` | Declined (insufficient funds) |

Any future expiry date, any CVC, any postal code.

## Razorpay

### Keys

From the Razorpay dashboard (Account and Settings, API keys), test mode first:

| Variable | Value |
| --- | --- |
| `RAZORPAY_KEY_ID` | `rzp_test_...` (sent to the browser for Checkout.js) |
| `RAZORPAY_KEY_SECRET` | The key secret (Basic auth, and the Checkout.js signature check) |
| `RAZORPAY_WEBHOOK_SECRET` | A secret you choose when creating the webhook |
| `RAZORPAY_API_BASE`, `RAZORPAY_CHECKOUT_SCRIPT_URL` | Leave unset (`https://api.razorpay.com`, `https://checkout.razorpay.com/v1/checkout.js`) |

On AWS: `enable_razorpay = true` and `razorpay_key_id` in `terraform.tfvars`, the two secrets
in `<name_prefix>/payments`. Subscriptions need the Subscriptions product enabled on the
Razorpay account.

### Webhook and events

Add a webhook on `https://<domain>/api/webhooks/razorpay` with your secret and these events
([`apps/api/src/services/payments/razorpay.ts`](../../apps/api/src/services/payments/razorpay.ts),
`normalizeRazorpayEvent`):

| Event | Used for |
| --- | --- |
| `payment.captured`, `order.paid` | Payment of a one-time order |
| `payment.failed` | A failed attempt (the order becomes FAILED; Razorpay may still capture a later attempt, which then pays it) |
| `subscription.authenticated`, `subscription.activated`, `subscription.updated`, `subscription.resumed` | Subscription status and period |
| `subscription.charged` | First payment and renewals |
| `subscription.pending`, `subscription.halted` | Failed renewal: PAST_DUE |
| `subscription.cancelled`, `subscription.completed` | Ended |
| `refund.processed`, `refund.failed` | Refund settlement |

The browser also posts Checkout.js's signed success payload to
`/api/checkout/razorpay/confirm`, so payments complete even before the webhook arrives.

Payments must be captured. The API captures an `authorized` payment when it fetches it on
confirm, but setting automatic capture in the Razorpay dashboard keeps webhooks and the
dashboard consistent.

### Test payments

In test mode (from Razorpay's test documentation; check it for the current list): the test
card `4111 1111 1111 1111` with any future expiry and any CVC, and the UPI ids
`success@razorpay` (succeeds) and `failure@razorpay` (fails).

Razorpay limits worth knowing: subscriptions take no first-payment coupon (checkout does not
offer coupons on Razorpay plans) and cannot be resumed after a cancel
(`409 RESUME_NOT_SUPPORTED`); the stub refuses orders below 100 paise, like Razorpay.

## Currencies and routing

In `/admin/settings` (ADMIN):

1. **Currencies**: the enabled list and the default. Learners pick among the enabled ones;
   the catalog shows prices in their choice, else their preferred currency, else the
   default.
2. **Routing**: which gateway charges each currency, plus a fallback. For example
   `{ INR: RAZORPAY, USD: STRIPE }` with fallback `STRIPE`. A currency routed to a gateway
   that is not configured (or cannot take it) falls back to the other gateway; if neither
   can, checkout answers `409 CURRENCY_NOT_PAYABLE`.
3. **Prices**: every course, bundle and plan needs a price in each currency you sell it in
   (course editor, Prices; `/admin/plans` for plans and bundles). There is no conversion: a
   course without an INR price cannot be bought in INR (`409 PRICE_NOT_AVAILABLE`), and the
   publish checklist requires at least one price for a PAID course.

## Tax

Also in `/admin/settings`:

| Field | Meaning |
| --- | --- |
| `enabled` | Off by default |
| `mode` | `EXCLUSIVE`: tax is added on top of the price. `INCLUSIVE`: prices already contain tax; it is carved out for the invoice |
| `rules` | `{ country, rateBps, label }`: the buyer's billing country (two letters, or `*` for everyone else) and the rate in basis points (1800 = 18%), with the label printed on invoices (for example `GST`, `VAT`) |

The rule is picked by the billing country the buyer enters at checkout; the rate, mode, label
and country are frozen on the order and the invoice. Set the **seller** block (legal name,
address, tax id, billing email) too: it is printed on every invoice and frozen at issue.

The LMS computes tax from your rules; it does not determine tax liability or file returns.
Check with an accountant which rules apply to your academy.

## Going live

1. Run purchases, a subscription, a renewal (Stripe test clocks or the Razorpay dashboard),
   a failed renewal and a refund in test mode.
2. Switch the keys and webhook secrets to live values, register live webhook endpoints, and
   roll the services.
3. Check `GET /api/admin/integrations` (or `/admin/settings`): it reports each gateway's mode
   without exposing keys.
4. Watch `/admin/orders` and the failed-jobs alarm for the first days. An order flagged
   `AMOUNT_MISMATCH` or `PAID_AFTER_CANCEL` needs a person
   ([grading-and-moderation.md](grading-and-moderation.md#orders-that-need-a-person)).
