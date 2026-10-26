# Walkthrough: a tour of the repository

A reading order for a new contributor: what lives where, which files to open first, and how
one request travels through them. Start the stack ([quickstart-local.md](quickstart-local.md))
so you can try each piece as you read.

## 0. The map

```
apps/
  api/         Express 5 API and BullMQ worker (one image, three entry points)
  web/         Next.js 15 web app: catalog, classroom, checkout, account, /admin
  stubs/       Stripe, Razorpay, OpenAI and euron-video-system stand-ins
packages/
  types/       DTOs and enums shared by api and web
  api-client/  the typed HTTP client the web app uses
  ui/          components and design tokens
db/            migrate.ts and migrations/0001_init.sql
deploy/compose compose.yaml (base), compose.floci.yaml, compose.aws.yaml
infra/
  docker/      api, web and stubs Dockerfiles
  terraform/   modules/ and envs/{local-floci,aws-dev,aws-prod}
scripts/       env generation, deploy, one-off tasks, test matrix, OpenAPI, sanitization
e2e/           Playwright
docs/          this documentation
```

## 1. The schema first

Read [`db/migrations/0001_init.sql`](../../db/migrations/0001_init.sql) top to bottom. Its
header states the conventions (ULIDs, `timestamptz(3)`, minor-unit money, counters, keyset
lists, one place for access), and the comments on each table say why its constraints exist.
[data-model.md](../architecture/data-model.md) is the annotated version.

## 2. Configuration and boot

1. [`apps/api/src/core/config.ts`](../../apps/api/src/core/config.ts): every environment
   variable, the production guard, the `set-me` rule.
2. [`apps/api/src/index.ts`](../../apps/api/src/index.ts) and
   [`worker.ts`](../../apps/api/src/worker.ts): boot order, the schedules.
3. [`apps/api/src/app.ts`](../../apps/api/src/app.ts): the middleware chain, webhooks before
   the JSON parser, the error handler.
4. [`apps/api/src/routes/index.ts`](../../apps/api/src/routes/index.ts): every mount point.

## 3. The core contracts

These small files are used by everything else:

| File | Read for |
| --- | --- |
| [`core/context.ts`](../../apps/api/src/core/context.ts) | `Actor`, `requireActive`, `requireArea` |
| [`core/effects.ts`](../../apps/api/src/core/effects.ts) | `withTransaction` and after-commit jobs |
| [`core/errors.ts`](../../apps/api/src/core/errors.ts) | `HttpError` and stable codes |
| [`core/validate.ts`](../../apps/api/src/core/validate.ts) | Strict zod parsing, `pageQuery` |
| [`jobs/registry.ts`](../../apps/api/src/jobs/registry.ts) | Every job name and payload |
| [`middleware/auth.ts`](../../apps/api/src/middleware/auth.ts), [`middleware/rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts) | Auth and budgets |

## 4. The domain, the rules worth arguing about

Open [`apps/api/src/domain`](../../apps/api/src/domain) next to
[`apps/api/test/unit`](../../apps/api/test/unit). In this order:

1. [`entitlements.ts`](../../apps/api/src/domain/entitlements.ts): who may open a course.
   Then [`services/access.service.ts`](../../apps/api/src/services/access.service.ts), the one
   service that loads its facts. ([entitlements.md](../architecture/entitlements.md))
2. [`pricing.ts`](../../apps/api/src/domain/pricing.ts) and
   [`orders.ts`](../../apps/api/src/domain/orders.ts): money arithmetic and the order state
   machine.
3. [`progress.ts`](../../apps/api/src/domain/progress.ts): heartbeats and completion.
4. [`quiz.ts`](../../apps/api/src/domain/quiz.ts) and
   [`rubric.ts`](../../apps/api/src/domain/rubric.ts): grading.
5. [`authoring-rules.ts`](../../apps/api/src/domain/authoring-rules.ts): question validation,
   video references, the publish checklist.
6. [`markdown.ts`](../../apps/api/src/domain/markdown.ts),
   [`safe-url.ts`](../../apps/api/src/domain/safe-url.ts),
   [`media-rules.ts`](../../apps/api/src/domain/media-rules.ts): what input survives.
7. [`admin-permissions.ts`](../../apps/api/src/domain/admin-permissions.ts): the `/admin`
   area matrix.

## 5. Follow one request: a learner buys a course

Trace it in the code with the stub running ([payments.md](../architecture/payments.md)):

1. **Web**: [`apps/web/src/components/checkout/checkout-page.tsx`](../../apps/web/src/components/checkout/checkout-page.tsx)
   asks for a quote, then starts with an idempotency key from
   [`apps/web/src/lib/checkout.ts`](../../apps/web/src/lib/checkout.ts).
2. **Route**: `POST /api/checkout/start` in
   [`routes/checkout.routes.ts`](../../apps/api/src/routes/checkout.routes.ts) (auth, rate
   limit), its controller parses the body.
3. **Service**: `start()` in
   [`services/checkout.service.ts`](../../apps/api/src/services/checkout.service.ts): the
   quote from the price book, the order insert, the gateway handoff.
4. **Gateway**: [`services/payments/stripe.ts`](../../apps/api/src/services/payments/stripe.ts)
   creates the Checkout Session against `STRIPE_API_BASE` (the stub).
5. **Stub**: [`apps/stubs/server.mjs`](../../apps/stubs/server.mjs) serves the hosted page;
   **Pay** signs and sends `checkout.session.completed`.
6. **Webhook**: [`services/payments/webhook.service.ts`](../../apps/api/src/services/payments/webhook.service.ts)
   verifies, stores once, finds the order.
7. **Fulfilment**: [`services/payments/fulfilment.service.ts`](../../apps/api/src/services/payments/fulfilment.service.ts)
   locks, checks the amount, marks PAID, calls
   [`services/enrollment.service.ts`](../../apps/api/src/services/enrollment.service.ts),
   issues the invoice ([`services/invoice.service.ts`](../../apps/api/src/services/invoice.service.ts)),
   and queues the PDF and the receipt.
8. **Worker**: [`jobs/billing.jobs.ts`](../../apps/api/src/jobs/billing.jobs.ts) renders the
   invoice and mails the receipt.
9. **Return page**: [`apps/web/src/components/checkout/order-status-page.tsx`](../../apps/web/src/components/checkout/order-status-page.tsx)
   polls `GET /api/checkout/orders/:id` every 2 s while the order is pending; the first call
   adds `?sync=1`, which asks Stripe once in case the webhook has not arrived.

## 6. Follow another: a learner watches a lecture

1. [`apps/web/src/components/classroom/lecture-video.tsx`](../../apps/web/src/components/classroom/lecture-video.tsx)
   asks for playback; [`components/player/video-player.tsx`](../../apps/web/src/components/player/video-player.tsx)
   plays it and sends beats.
2. [`services/playback.service.ts`](../../apps/api/src/services/playback.service.ts): access
   check, then [`integrations/evs.ts`](../../apps/api/src/integrations/evs.ts) mints the
   session.
3. [`services/classroom.service.ts`](../../apps/api/src/services/classroom.service.ts) `beat()`
   and [`services/progress.service.ts`](../../apps/api/src/services/progress.service.ts):
   watched time, completion, the rollup, the certificate.

([video.md](../architecture/video.md), [progress-and-certificates.md](../architecture/progress-and-certificates.md))

## 7. The rest of the API, by module

| Module | Service files |
| --- | --- |
| Accounts | `auth.service.ts`, `account.service.ts`, `user.service.ts`, `security/` |
| Catalog | `catalog.service.ts`, `category.service.ts` |
| Authoring | `admin-course.service.ts`, `curriculum.service.ts`, `question.service.ts`, `authoring-ai.service.ts`, `evs.service.ts` |
| Classroom | `classroom.service.ts`, `playback.service.ts`, `progress.service.ts`, `note.service.ts`, `my-learning.service.ts`, `certificate.service.ts` |
| Assessments | `quiz.service.ts`, `submission.service.ts`, `grading.service.ts` |
| Community | `review.service.ts`, `qa.service.ts`, `report.service.ts`, `moderation.service.ts` |
| Commerce | `checkout.service.ts`, `payments/*`, `subscription.service.ts`, `refund.service.ts`, `invoice.service.ts`, `billing.service.ts`, `admin-commerce.service.ts` |
| Operations | `admin-learners.service.ts`, `admin-certificates.service.ts`, `staff.service.ts`, `admin-settings.service.ts`, `admin-stats.service.ts`, `audit.service.ts`, `notification.service.ts`, `media.service.ts` |

Repositories and presenters follow the same names. The module design is in
[LLD.md](../architecture/LLD.md).

## 8. The web app

| Path | Holds |
| --- | --- |
| [`apps/web/src/app`](../../apps/web/src/app) | Routes in groups: `(auth)`, `(main)` (catalog, checkout, account, verify), `(classroom)`, `(admin)` |
| [`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts) | The per-request CSP |
| [`apps/web/src/lib`](../../apps/web/src/lib) | `session.ts` (memory token), `auth.tsx`, `api.ts`, `checkout.ts`, `currency.ts`, `runtime-env.ts`, `errors.ts` (code to message) |
| [`apps/web/src/components`](../../apps/web/src/components) | Feature folders: `catalog`, `course`, `checkout`, `classroom`, `player`, `account`, `admin/*` |
| [`apps/web/DESIGN.md`](../../apps/web/DESIGN.md), [`TESTIDS.md`](../../apps/web/TESTIDS.md) | The design rules and the test id catalog |

## 9. Infrastructure

1. [`infra/terraform/modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf):
   the whole deployment in one composition; every other module is a building block.
2. [`infra/terraform/envs/aws-dev/main.tf`](../../infra/terraform/envs/aws-dev/main.tf) and
   `aws-prod`: sizes only. [`envs/local-floci`](../../infra/terraform/envs/local-floci/main.tf):
   the same modules against the emulator.
3. [`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh),
   [`scripts/aws-run-task.sh`](../../scripts/aws-run-task.sh): the deploy sequence.
4. [`deploy/compose/compose.yaml`](../../deploy/compose/compose.yaml): the local shape, with
   comments on every variable.

## 10. Tests

[testing.md](testing.md). Start with a unit test next to the domain file you are changing,
then the integration suite for the module (`apps/api/test/integration/<area>-*.int.test.ts`),
then the matrix if you touched storage, mail or AI.

## 11. Where to look for a change

| You want to change | Start at |
| --- | --- |
| Who can open a course | `domain/entitlements.ts` and its unit test |
| How a price is computed | `domain/pricing.ts` |
| A new gateway event | `normalizeStripeEvent` / `normalizeRazorpayEvent`, then `webhook.service.ts` |
| When an item counts as done | `domain/progress.ts`, `services/progress.service.ts` |
| A new setting | `packages/types` `LmsSettings`, `DEFAULT_SETTINGS`, the `settingsPatch` schema, the settings page |
| A new route | The route file (one statement, a doc comment), then `pnpm openapi` |
| A new job | `JobDefinitions` in `jobs/registry.ts`, a `register*Jobs`, a schedule in `worker.ts` if recurring |
| A new table | A new migration file, then `pnpm --filter @open-lms/api db:types` |
