# Quickstart: run Euron Open LMS locally

Start the whole stack on your machine with emulated AWS, seed a demo academy, and buy a
course through the stand-in Stripe page and the stand-in Razorpay modal. No cloud account,
no payment account and no API key are needed.

What runs ([`deploy/compose/compose.yaml`](../../deploy/compose/compose.yaml) plus
[`compose.floci.yaml`](../../deploy/compose/compose.floci.yaml)): Postgres 16, Redis 7,
Mailpit, the Floci AWS emulator provisioned by the production Terraform modules, the stubs
(Stripe, Razorpay, OpenAI and euron-video-system stand-ins), then a one-shot `migrate`, the
`api`, the `worker` and the `web` app.

## Prerequisites

- Docker with Compose v2 (Docker Desktop, OrbStack, Colima or plain Docker Engine), about
  4 GB of memory for the containers.
- `make`, `bash` and `openssl` (for `make env`).
- For the tests and for running apps outside Docker: Node 22 (`.nvmrc`) and pnpm 9
  (`corepack enable`), then `pnpm install`.

## Start the stack

```bash
make up
```

`make up` runs `make env` first: it writes `deploy/compose/.env` with random, local-only
secrets (JWT and refresh secrets, the TOTP key, the demo password, and the Stripe, Razorpay
and EVS secrets the API shares with the stubs) and never overwrites a value
([`scripts/gen-local-env.sh`](../../scripts/gen-local-env.sh)). Then it builds the images
and waits until every service is healthy. The first build takes a few minutes. When it is
done it prints:

```
  app      http://localhost:3530
  api      http://localhost:5026/api/ready
  mail     http://localhost:8046
  s3/ses   http://localhost:4597  (Floci)
  stubs    http://localhost:5119  (Stripe, Razorpay, AI and video stand-ins)
```

Check the API: `curl -s localhost:5026/api/ready` answers `{"ok":true}` when Postgres and
Redis respond.

## Seed the demo academy

```bash
make demo
```

This runs `node dist/cli.js demo:seed` inside the API container
([`apps/api/src/demo/seed.ts`](../../apps/api/src/demo/seed.ts)): Northwind Academy, twelve
courses across five categories with real curricula (EVS video lessons the stub plays,
articles, PDF cheat sheets, quizzes from a question bank, projects with rubrics), three
instructors, support and finance staff, an admin and 36 learners, two bundles, an
all-access plan monthly and yearly in USD and INR, coupons, paid orders with invoices, a
refund with its credit note, subscriptions in several states, progress at every stage,
certificates, reviews and Q&A. It sets the academy to sell in USD (Stripe) and INR
(Razorpay, 18% GST on top for buyers in India). Running it again only prints the logins.

## Sign in

Every demo account shares one password: `LMS_DEMO_PASSWORD` in `deploy/compose/.env`
(`make demo` prints it).

| Who | Email | What to look at |
| --- | --- | --- |
| Admin | `admin@example.com` | `/admin`: every area, settings, staff, audit |
| Support | `support@example.com` | Learners, grading, orders (read only), certificates, moderation |
| Finance | `finance@example.com` | Orders and refunds, plans and bundles, coupons |
| Instructor | `maya.okafor@example.com` | Owns three courses, has projects to grade |
| Learner | `juniper.vale@example.com` | Courses in progress, a certificate, a subscription |
| Learner (INR) | `rohan.mehta@example.com` | Pays in INR through Razorpay |

## Try a purchase

Create a fresh learner so nothing is owned yet:

1. Open http://localhost:3530/signup and sign up with any address on a reserved domain
   (for example `you@example.test`).
2. Open Mailpit at http://localhost:8046, open the verification email and follow the link.
   You are signed in.

**Stripe (USD).**

1. Open http://localhost:3530/courses/practical-sql. Pick USD in the currency menu.
2. Press the buy button. On the checkout page enter the billing name and country (both
   required; the country decides the tax) and, optionally, the coupon `WELCOME20` (20% off
   a course).
3. Continue to payment. The browser goes to the stub's hosted page,
   `http://localhost:5119/stub/stripe/checkout/<session id>`, a plain test page standing in
   for Stripe Checkout, with **Pay**, **Fail** and **Cancel**.
4. Press **Pay**. The stub completes the session, sends a signed
   `checkout.session.completed` webhook to the API, and redirects back to
   `/checkout/orders/<order id>`. The order is PAID, the course opens, the receipt is in
   Mailpit and the invoice PDF is under `/account/orders`.

Press **Fail** instead to see a failed order, or **Cancel** to come back with nothing paid.

**Razorpay (INR).**

1. Open another paid course, for example `/courses/modern-typescript`, and pick INR. Set the
   billing country to India to see GST added.
2. Continue to payment. The page loads the stub's `checkout.js` and opens a "Test payment
   (local stub)" modal over the page, standing in for Razorpay's, with **Pay**, **Fail** and
   **Close**.
3. Press **Pay**. The stub captures the payment, sends `payment.captured` and `order.paid`
   webhooks, and hands the page a correctly signed success payload, which the page posts to
   `/api/checkout/razorpay/confirm`. Either path fulfils the order; the other is a no-op.

**A subscription.** Open `/plans`, choose monthly or yearly, and pay the same way. Courses
marked as included in the plan then open from their pages. The stub can drive the rest of
the lifecycle (`/stub/stripe/subscriptions/:id/renew`, `/fail`, `/end` and the Razorpay
equivalents; see [`apps/stubs/README.md`](../../apps/stubs/README.md)).

**A refund.** Sign in as `finance@example.com`, open `/admin/orders`, find your order and
refund part or all of it. A credit note is issued and the refund email lands in Mailpit.

## Where things are

| | |
| --- | --- |
| Mail | Every email the stack sends goes through emulated SES and is relayed to Mailpit: http://localhost:8046 |
| Media | Uploads go to the emulated S3 bucket `open-lms-local-media` (SSE-KMS) through presigned URLs on http://localhost:4597 |
| Video | Demo lessons are EVS lectures; the stub mints sessions and serves a short test HLS stream from http://localhost:5119 |
| AI | `AI_PROVIDER=stub`: quiz drafting, grading suggestions and polish answer deterministically. Put `[[ai:fail]]` in the text to see the error path |
| Logs | `make logs SERVICE=api` (or `worker`, `web`, `stubs`, `migrate`, `terraform`, `floci`) |

## Create an administrator

```bash
make admin EMAIL=you@example.com
```

An existing account is promoted to ADMIN without touching its password; a new one is
created and a set-password link is emailed (read it in Mailpit).

## Day-to-day commands

| Command | Does |
| --- | --- |
| `make up` / `make down` | Start, or stop and delete every volume |
| `make ps`, `make logs SERVICE=api` | Status, logs |
| `make demo` | Seed (idempotent) |
| `make test`, `make test-integration`, `make test-matrix`, `make e2e` | Tests ([testing.md](testing.md)) |
| `make lint typecheck build` | Quality gates |
| `make openapi` | Regenerate `docs/api/openapi.yaml` |
| `make sanitize` | Scan for credentials, real emails and IPs |

### Running the apps outside Docker

With the stack up (Postgres, Redis, Floci, Mailpit and the stubs keep running), stop the
container you want to replace and run it from source with the same settings:

```bash
docker compose --env-file deploy/compose/.env -f deploy/compose/compose.yaml \
  -f deploy/compose/compose.floci.yaml stop api worker web
pnpm --filter @open-lms/api dev          # tsx watch on :5026
pnpm --filter @open-lms/api dev:worker
pnpm --filter @open-lms/web dev          # next dev on :3530, proxies /api to :5026
```

Outside compose the API reads its configuration from the environment
([configuration.md](configuration.md)); export at least `DATABASE_URL`
(`postgres://lms:lms@localhost:5492/lms`), `REDIS_URL` (`redis://localhost:6429`), the
secrets from `deploy/compose/.env` under their API names, and the stub base URLs on
`http://localhost:5119`.

## Ports

All host ports bind to `127.0.0.1` and can be changed in `deploy/compose/.env` (or your
shell) with the variable shown.

| Service | Host port | Variable | Notes |
| --- | --- | --- | --- |
| Web app | 3530 | `LMS_WEB_PORT` | The only URL a browser needs; it proxies `/api/*` |
| API | 5026 | `LMS_API_PORT` | Published for curl and tools |
| Floci (S3, SES, KMS, Secrets Manager) | 4597 | `LMS_FLOCI_PORT` | Browsers use it for presigned uploads |
| Postgres | 5492 | `LMS_PG_PORT` | user `lms`, password `lms`, database `lms` |
| Redis | 6429 | `LMS_REDIS_PORT` | |
| Mailpit UI | 8046 | `LMS_MAILPIT_PORT` | |
| Mailpit SMTP | 1046 | `LMS_SMTP_PORT` | Used by `MAIL_MODE=smtp` and the test matrix |
| Stubs | 5119 | `LMS_STUB_PORT` | Hosted checkout pages, `checkout.js`, the HLS stream |

## Reset

```bash
make down && make up && make demo
```

`make down` deletes every volume (database, Redis, media, the emulator and its Terraform
state) together. Delete `deploy/compose/.env` too if you want new secrets.

## Next steps

- [walkthrough.md](walkthrough.md): a tour of the repository.
- [payments.md](payments.md) and [video-with-evs.md](video-with-evs.md): real Stripe,
  Razorpay and euron-video-system instead of the stubs.
- [local-with-aws.md](local-with-aws.md): the local containers against real S3 and SES.
- [deploy-aws.md](deploy-aws.md): a real deployment.
