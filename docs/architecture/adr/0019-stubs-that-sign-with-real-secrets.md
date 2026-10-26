# ADR 0019: Stand-ins that sign with the real secrets

## Status

Accepted.

## Context

Every interesting flow crosses a third party: hosted checkout and webhooks (Stripe),
Checkout.js and webhooks (Razorpay), playback sessions, a video stream and webhooks (EVS),
JSON completions (the AI). Contributors should run all of it with no account anywhere,
tests should be deterministic, and the code under test must be the production client code,
including signature verification, not a mock that skips it.

## Decision

- [`apps/stubs/server.mjs`](../../../apps/stubs/server.mjs) is one dependency-free Node
  server (port 5119) that speaks the subset of the Stripe, Razorpay, OpenAI and EVS APIs
  the LMS uses, with their error shapes ([README](../../../apps/stubs/README.md)).
- It **signs** every webhook exactly like the real service, with the secrets the API
  verifies with: `make env` generates `LMS_STRIPE_WEBHOOK_SECRET`,
  `LMS_RAZORPAY_KEY_SECRET`, `LMS_RAZORPAY_WEBHOOK_SECRET`, `LMS_EVS_WEBHOOK_SECRET` and the
  key values, and compose passes the same values to both containers
  ([`deploy/compose/compose.yaml`](../../../deploy/compose/compose.yaml)). The API's real
  verification code runs on every local payment.
- Browser-facing parts are real pages: a hosted Stripe checkout with Pay, Fail and Cancel,
  a fake `checkout.js` defining `window.Razorpay` whose Pay returns a correctly signed
  payload, and an HLS stream with tokenised URLs.
- Simulation endpoints drive the hard cases: renewals, failed renewals, cancellations, a
  refund that fails (amounts ending in 13), async webhook delivery or none, EVS
  `video.ready` / `video.failed`, and `[[ai:fail]]` for the AI.
- Only base URLs differ from production (`STRIPE_API_BASE`, `RAZORPAY_API_BASE`,
  `RAZORPAY_CHECKOUT_SCRIPT_URL`, `EVS_BASE_URL`, `AI_STUB_URL`). `AI_PROVIDER=stub` is
  refused in production; stub payment base URLs are warned about.

## Consequences

Positive:

- `make up && make demo` gives working purchases, subscriptions, refunds and video with no
  credentials.
- Integration tests exercise signature verification, deduplication and amount checks.

Trade-offs:

- The stub can drift from the real APIs; real test-mode accounts remain the final check
  ([guides/payments.md](../../guides/payments.md)).
- A stub base URL in production is only a warning today, not a refusal.

## Alternatives considered

- **Gateway SDK mocks.** Skip the HTTP and signature layers the LMS must get right.
- **Real test-mode accounts for everyone.** Accurate, but needs credentials and network for
  every contributor and CI run.
