# Testing

Four layers of tests, and the gates that run them:

| Layer | Runs | Needs | Command |
| --- | --- | --- | --- |
| Unit | Pure functions, presenters, gateway normalisers, web components and models | Node and pnpm | `make test` (`pnpm test`) |
| Integration | The real API in-process (supertest) against Postgres and Redis | Postgres and Redis (compose starts them) | `make test-integration` |
| Matrix | The integration suite under every storage, mail and AI backend: 12 runs | The full local stack (`make up`) | `make test-matrix` |
| End-to-end | Playwright against the running stack | `make up` and `make demo` | `make e2e` |

## Unit tests

Vitest in every package (`pnpm test` runs them all through Turborepo):

| Package | Tests | Covers |
| --- | --- | --- |
| `apps/api` | [`test/unit`](../../apps/api/test/unit) | `entitlements` (every decision order case, grace), `pricing` (coupon allocation, inclusive and exclusive tax, rounding), `orders` (state machine, amount match), `quiz` (snapshots, grading, reveal, overdue), `progress` (anti-skip beats, completion, streak), `rubric-markdown` (clamping, XSS cases), `safe-url`, `media-rules` (allowlist, magic bytes), `authoring-rules` (question validation, video refs, publish checklist), `commerce-gateways` (Stripe and Razorpay signatures and event normalisers), `commerce-redact`, `admin-permissions`, `hardening`, `logger-redaction`, presenters |
| `apps/web` | [`test`](../../apps/web/test) | The CSP builder, session and refresh, access call-to-action, catalog filters, the player helpers and beat accumulator, quiz state, the curriculum builder, coupon, price and refund forms, settings |
| `packages/api-client` | [`test`](../../packages/api-client/test) | Single-flight refresh, the cross-tab lock, pagination, uploads |
| `packages/ui` | [`test`](../../packages/ui/test) | Components |
| `apps/stubs` | [`test`](../../apps/stubs/test) | Stub signatures and flows |

A rule worth arguing about lives in `apps/api/src/domain/` and gets a unit test there first.

## Integration tests

```bash
make test-integration
```

This makes sure Postgres and Redis answer on the compose ports (starting just those two
containers if needed, [`scripts/test-db.sh`](../../scripts/test-db.sh)), then runs
`pnpm test:integration` with:

```bash
TEST_DATABASE_URL=postgres://lms:lms@localhost:5492/lms_test
TEST_REDIS_URL=redis://localhost:6429/1
```

What the harness does ([`vitest.integration.config.mts`](../../vitest.integration.config.mts),
[`apps/api/test/integration`](../../apps/api/test/integration)):

- **Refuses** any database whose name does not end in `_test`
  ([`guard.ts`](../../apps/api/test/integration/guard.ts)), then drops, recreates and
  migrates it once per run ([`global-setup.ts`](../../apps/api/test/integration/global-setup.ts)).
- Sets the API's environment before it loads ([`env.ts`](../../apps/api/test/integration/env.ts)):
  `NODE_ENV=test`, `JOBS_MODE=inline` (job handlers run right after commit, so assertions
  are deterministic), `BCRYPT_ROUNDS=4`, rate limits off (tests that assert a 429 switch them
  on), `MAIL_MODE=outbox` (tests read links from the in-memory outbox), `STORAGE=local` and
  `AI_PROVIDER=stub` unless the matrix says otherwise.
- Mounts `createApp()` in-process; every test creates its own users and courses, so tests
  do not depend on each other. Files run one at a time because they share the database.
- The commerce suites start the stubs **in-process** on an ephemeral port with their own
  keys ([`commerce-setup.ts`](../../apps/api/test/integration/commerce-setup.ts)), so the
  real Stripe and Razorpay clients, signature verification, deduplication and amount checks
  run against signed webhooks.

Suites by area: `core-*` (auth, account, hardening, media, notifications), `learning-*`
(catalog, classroom, my learning, playback), `assessments-*` (quiz, assignments),
`authoring-*` (courses, curriculum, EVS and AI), `community-*` (Q&A, reviews),
`commerce-*` (checkout, Stripe, Razorpay, subscriptions, admin), `admin-*` (authorisation,
jobs, operations).

Run one file: `TEST_DATABASE_URL=... pnpm exec vitest run --config vitest.integration.config.mts commerce-stripe`.

## The backend matrix

```bash
make up          # Postgres, Redis, Floci, Mailpit and the stubs must be reachable
make test-matrix
```

[`scripts/test-matrix.sh`](../../scripts/test-matrix.sh) runs the whole integration suite
under every combination:

| Dimension | Values |
| --- | --- |
| `STORAGE` | `local`, `s3` (Floci) |
| `MAIL_MODE` | `outbox`, `smtp` (Mailpit), `ses` (Floci, relayed to Mailpit) |
| `AI_PROVIDER` | `none` (AI off: hidden, 503s), `stub` |

2 x 3 x 2 = 12 runs. Each row gets a fresh `lms_matrix_NN_test` database and its own Redis
logical database, and the script prints a table and exits non-zero if any row fails. Both
gateways run in every row (the commerce suites start their own stubs). `ONLY=s3` runs the
rows whose label contains `s3`; `FILTER=media` passes a file filter to vitest.

## Browser end-to-end tests

```bash
make e2e         # = make up, make demo, then pnpm e2e
E2E_HEADED=1 pnpm e2e
```

Playwright ([`e2e/playwright.config.ts`](../../e2e/playwright.config.ts)) drives Chromium
against `E2E_BASE_URL` (default `http://localhost:3530`), one worker, and reads mail from
Mailpit ([`e2e/helpers.ts`](../../e2e/helpers.ts)). Today the suite has one spec,
[`e2e/tests/01-auth.spec.ts`](../../e2e/tests/01-auth.spec.ts): sign up in the UI, confirm
from the email, land back on the course, survive a reload, sign out. Reports go to
`e2e/.report`, traces and screenshots to `e2e/.results`.

## Browser QA by hand

`make up && make demo`, then follow [quickstart-local.md](quickstart-local.md#try-a-purchase).
The stubs make the hard cases reachable from a terminal:

| To see | Do |
| --- | --- |
| A failed Stripe payment | **Fail** on the hosted page |
| A lost webhook | `curl -X POST -H 'Accept: application/json' 'http://localhost:5119/stub/stripe/checkout/<session id>/pay?deliver=none'` pays without sending the webhook; then open `/checkout/orders/<order id>` (the return page syncs with the stub) or wait for `billing.reconcile-pending` |
| A renewal, a failed renewal, an ended subscription | `POST http://localhost:5119/stub/stripe/subscriptions/<sub id>/renew`, `/fail`, `/end` (and the `/stub/razorpay/...` equivalents) |
| A refund that fails | Refund an amount ending in 13 minor units |
| An EVS video becoming ready or failing | `POST http://localhost:5119/stub/evs/videos/<id>/ready` or `/failed` |
| An AI error | Put `[[ai:fail]]` in the lesson or submission text |
| Webhooks the stub sent | `GET http://localhost:5119/stub/webhooks` |

## API reference check

`pnpm openapi --check` fails when [`docs/api/openapi.yaml`](../api/openapi.yaml) no longer
matches the route files; `pnpm openapi` regenerates it
([`scripts/gen-openapi.ts`](../../scripts/gen-openapi.ts)).

## Infrastructure checks

| Command | Runs |
| --- | --- |
| `make tf-validate` | `terraform fmt -check` and `validate` for `local-floci`, `aws-dev`, `aws-prod` (no backend, no credentials) |
| `make tf-lint` | tflint, recursive |
| `make tf-security` | checkov with [`infra/terraform/.checkov.yaml`](../../infra/terraform/.checkov.yaml); any unskipped finding fails |
| `make sanitize` | [`scripts/check-sanitization.sh`](../../scripts/check-sanitization.sh): credentials, account ids, real emails, public IPs, committed env files |

## Continuous integration

- [`.github/workflows/checks.yml`](../../.github/workflows/checks.yml) on every push and pull
  request: lint, typecheck, unit tests, `pnpm openapi --check`, the sanitization scan,
  Terraform fmt and validate.
- [`.github/workflows-full/`](../../.github/workflows-full/README.md), opt-in for forks:
  integration tests on Postgres 16 and Redis 7 service containers, gitleaks, CodeQL,
  `pnpm audit`, tflint and checkov, multi-arch image builds, and the e2e job (stack on Floci,
  `make demo`, the matrix, then Playwright).

Before a pull request: `pnpm lint typecheck test build`, `make test-integration`, and the
matrix, e2e or Terraform checks when you touched those areas
([CONTRIBUTING.md](../../CONTRIBUTING.md)).
