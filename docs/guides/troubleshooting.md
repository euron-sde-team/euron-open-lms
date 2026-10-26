# Troubleshooting

Symptoms, causes and fixes, grouped by area. Error codes are listed in
[LLD.md](../architecture/LLD.md#10-errors); every error body carries a `requestId` that finds
the log line.

## Local stack

### A port is already in use

Every host port can be moved in `deploy/compose/.env` (or your shell): `LMS_WEB_PORT`,
`LMS_API_PORT`, `LMS_PG_PORT`, `LMS_REDIS_PORT`, `LMS_MAILPIT_PORT`, `LMS_SMTP_PORT`,
`LMS_FLOCI_PORT`, `LMS_STUB_PORT` ([quickstart-local.md](quickstart-local.md#ports)). The
browser-facing URLs follow the web, Floci and stub ports automatically.

### `run make env first`

Compose refuses to start without the generated secrets. `make up` runs `make env` for you;
when calling `docker compose` directly, run `make env` once.

### The `terraform` one-shot fails, or `migrate` never completes

`make logs SERVICE=terraform` (or `migrate`). Emulator state and its Terraform state live in
two volumes that must be reset together: `make down && make up`. A stale `.terraform`
directory from running Terraform on the host can also confuse the container: delete
`infra/terraform/envs/local-floci/.terraform` and retry.

### Which database does it connect to without `DATABASE_URL`?

With neither `DATABASE_URL` nor `DATABASE_SECRET_ARN`, the API, the CLI and the migration
runner use `postgres://lms:lms@localhost:5492/lms`, the compose Postgres
([`apps/api/src/db/connection-config.ts`](../../apps/api/src/db/connection-config.ts)).

## Boot and configuration

### `Refusing to start with an insecure configuration`

`NODE_ENV=production` with a problem from `assertProductionConfig` (development secrets,
`STORAGE=local`, `MAIL_MODE=outbox`, `JOBS_MODE=inline`, `AI_PROVIDER=stub`, no
`CORS_ORIGINS`, a localhost `APP_WEB_URL`, ...). The message lists each one; the fixes are in
[configuration.md](configuration.md#production-guard).

### `Invalid configuration`

A variable failed validation (for example `TOTP_ENCRYPTION_KEY` is not 32 bytes of base64, or
`APP_WEB_URL` is not a URL). The message names each field.

### `config: no payment gateway is configured` in the log

A warning only: free courses and grants work, paid courses cannot be bought. Configure
Stripe or Razorpay ([payments.md](payments.md)).

## Sign-in and sessions

### `403 CORS_ORIGIN_DENIED`

A non-GET request whose `Origin` is not in `CORS_ORIGINS` (default `APP_WEB_URL`). Open the
app on the exact origin configured (for example `http://localhost:3530`, not `127.0.0.1`).

### Signed out on every page load

The refresh cookie is not kept: `COOKIE_SECURE=true` on plain http, or the app reached on a
different origin than the API's cookie path. Locally compose sets `COOKIE_SECURE=false`;
behind https leave it on `auto`. `POST /api/auth/refresh` answers 204 when no cookie arrived.

### Sign-in answers `429 RATE_LIMITED`

The failure budgets (5 per account and IP per 15 minutes, 50 per account per hour) are spent;
every attempt answers 429 until the window passes, right password or not. Use "Forgot
password", or wait.

### No verification or reset email

Locally: Mailpit (http://localhost:8046). On AWS: the SES sandbox (unverified recipient), the
SES suppression list, or `MAIL_FROM` on an unverified identity; the API logs a failed send.

## Payments

### An order stays PENDING after paying

| Check | Meaning |
| --- | --- |
| The order page (`/admin/orders/<id>`) event timeline is empty | No webhook arrived: the endpoint URL, the gateway dashboard's delivery log, a WAF or proxy in between |
| A webhook with outcome `ORDER_NOT_FOUND` | The event is for an order this deployment does not know (another environment's endpoint, or a test event) |
| `AMOUNT_MISMATCH` on the order | The gateway charged a different amount or currency; nothing was granted ([operations.md](operations.md#payment-reconciliation)) |
| API log `webhook rejected` with `signature mismatch` | The webhook secret differs from the endpoint's signing secret, or something re-encoded the body |
| API log `Stripe webhooks are not configured` | `STRIPE_WEBHOOK_SECRET` unset |

The learner's return page asks Stripe once (`?sync=1`), and `billing.reconcile-pending` asks
the gateway about pending orders after their window (60 minutes by default) every 10 minutes.

### Checkout answers `409`

| Code | Meaning |
| --- | --- |
| `ALREADY_OWNED` | The learner can already open every course in the item |
| `SUBSCRIPTION_EXISTS` | Buying a plan with a live subscription |
| `CHECKOUT_IN_PROGRESS` | Another plan checkout is open in another tab, or a start is being prepared; finish or cancel it |
| `PRICE_NOT_AVAILABLE` | No price for that currency (add one in the course or plan editor) |
| `CURRENCY_NOT_PAYABLE` | No configured gateway takes that currency (Razorpay takes INR only; check routing) |
| `NOT_FOR_SALE` | The course is FREE (enroll from its page) or SUBSCRIPTION_ONLY |
| `COUPON_INVALID` | `details.reason`: `EXPIRED`, `NOT_STARTED`, `EXHAUSTED`, `ALREADY_USED`, `CURRENCY_MISMATCH`, `NOT_APPLICABLE` (also on Razorpay plans and during trials) |
| `CHECKOUT_CLOSED`, `CHECKOUT_EXPIRED` | The order behind this idempotency key is no longer payable; the web app starts a new one |

### `502 GATEWAY_ERROR` on start

Stripe or Razorpay refused or did not answer; the message (no secrets) says which and why,
and the order is closed as FAILED. Common causes: a key for the wrong mode or account, a
Razorpay amount below its minimum, a currency the Stripe account cannot charge.

### The Razorpay modal does not open

The browser console shows the CSP blocking `checkout.razorpay.com`, or the script URL is the
stub's while the keys are real (set `RAZORPAY_CHECKOUT_SCRIPT_URL` back to the default).

### A refund answers `409 REFUND_EXCEEDS` or `NOT_REFUNDABLE`

`REFUND_EXCEEDS`: more than total minus refunded minus refunds still pending
(`details.refundableMinor`). `NOT_REFUNDABLE`: the order is not PAID or PARTIALLY_REFUNDED,
or took no payment (a 100% coupon). Only ADMIN and FINANCE can refund.

## Classroom

### `403 COURSE_ACCESS_REQUIRED`

`details.reason` says why ([entitlements.md](../architecture/entitlements.md#lapsed-reasons)):
`NOT_ENROLLED`, `EXPIRED` (a grant or purchase past `valid_until`), `REVOKED`, `REFUNDED`,
`SUBSCRIPTION_ENDED`, `INACTIVE_ACCOUNT`. The learner detail in `/admin/learners` (`GET /api/admin/learners/:id`) shows
each enrollment with whether it grants access now.

### `409 STAFF_PREVIEW` or `409 PREVIEW`

Staff browsing a course they teach (or ADMIN/SUPPORT) have no enrollment, so progress,
quizzes and submissions are refused. A free preview opens content but records nothing. Use a
learner account to test learning.

### A video does not complete

Completion needs `videoCompletePercent` (90 by default) of the video **actually played**;
seeking ahead does not count. A lecture with `duration_seconds = 0` uses the duration the
player reports. Check the item's progress in the classroom (watched percent).

### Heartbeats answer 429

`learn-progress` allows 240 beats per hour per learner, and the player sends one every 15
seconds plus one on each pause, end, tab hide and unmount. A learner watching continuously
for an hour with pauses can exceed it; the beats in between are lost (the next accepted beat
can claim at most 60 seconds of watching). If learners report videos that do not complete
after long sessions, this is the cause; the budget is set in
[`apps/api/src/routes/learn.routes.ts`](../../apps/api/src/routes/learn.routes.ts).

## Video

| Symptom | Cause |
| --- | --- |
| `503 VIDEO_NOT_CONFIGURED` | `EVS_BASE_URL` or `EVS_PLAYBACK_KEY` missing or `set-me` |
| `502 VIDEO_SERVICE_UNAVAILABLE` / `VIDEO_SERVICE_ERROR` | EVS unreachable, or it refused the key |
| `409 VIDEO_NOT_READY` | Still processing in EVS, or the lecture's status is not READY (a missed `video.ready` webhook: re-attach the video or resend the event from EVS) |
| A black player and CSP errors in the console | `VIDEO_ORIGINS` on the web app lacks the manifest or segment origin |
| Publishing answers `422 PUBLISH_BLOCKED` with `VIDEO_NOT_READY` | A video lecture has no video, or its video is processing or failed |

Details: [video-with-evs.md](video-with-evs.md#troubleshooting).

## Assessments

| Code | Meaning |
| --- | --- |
| `409 NO_ATTEMPTS_LEFT` | `max_attempts` closed attempts used |
| `409 ATTEMPT_OVERDUE` | Autosave after the deadline; the next read or submit closes it as EXPIRED on the autosaved answers |
| `409 QUIZ_EMPTY` | No questions (FIXED with none chosen, or RANDOM with no matching tags) |
| `409 SUBMISSION_PENDING` | A version is waiting for review |
| `409 PAST_DUE` | Late work not allowed for this assignment |
| `409 ALREADY_REVIEWED` | Someone already decided this version |
| `422 BELOW_PASS_MARK` | Approving needs the pass points |
| No answers shown after a quiz | The reveal policy (`AFTER_PASS` until a pass or the last attempt, or `NEVER`) |

## Certificates, invoices and media

### `409 CERTIFICATE_RENDERING` or `INVOICE_RENDERING`

The PDF job has not run: a stopped worker, or a failed job (worker log, the failed-jobs
alarm). It is idempotent; retry it ([operations.md](operations.md#background-jobs)).

### Upload fails with a CORS error, or images do not display

The bucket's CORS rule must allow the app origin (Terraform does for the app URL;
`media_cors_extra_origins` for others), and the web app's `MEDIA_ORIGINS` must include the
bucket (or emulator) origin for the CSP.

### `MEDIA_SIZE_MISMATCH` or `MEDIA_TYPE_MISMATCH` on complete

The stored object's size differs from what was declared, or its first bytes do not match
the declared type (a renamed file). Upload the real file with its real type.

## Mail

| Mode | Where to look |
| --- | --- |
| `outbox` | `.eml` files in `DATA_DIR/outbox` (development only) |
| `smtp` | Your relay; Mailpit locally |
| `ses` | SES sending statistics, the suppression list, the configuration set's events; Mailpit locally (Floci relays) |

A learner who switched a category off gets no email for it; receipts, refunds and security
mail always go.

## AI

### The AI buttons are missing

`GET /api/meta` reports the AI flags off: `AI_PROVIDER=none`, or a real provider without a
usable key (unset or `set-me`). The routes answer `503 AI_UNAVAILABLE`.

### `502 AI_FAILED`

The provider answered with an error or timed out. Locally, text containing `[[ai:fail]]`
triggers it on purpose.

## Jobs

### `JOBS_MODE=inline` surprises

Handlers run in the API after each commit, with no retries and **no schedules**: no
reconciliation, no subscription expiry, no mail sweep, no upload expiry, no purge. Use it for
tests only; production refuses it.

### Rate limits during a Redis outage

Each API task falls back to an in-memory limiter with the same budget, so the effective
budget is multiplied by the number of tasks until Redis returns.
