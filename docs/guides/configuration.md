# Configuration reference

Every environment variable the API, the worker and the web app read, with its default and
purpose; the academy settings edited in `/admin/settings`; and how the local compose stack
and Terraform set them.

The API and worker read one schema, [`apps/api/src/core/config.ts`](../../apps/api/src/core/config.ts),
validated with zod at boot (`Invalid configuration: ...` lists every bad value). Booleans
accept `true`, `false`, `1`, `0` or empty. Outside production the security-critical values
fall back to development defaults so `make up` works with no setup; with
`NODE_ENV=production` the [production guard](#production-guard) refuses to boot while any
of them is still a default.

A key value of `set-me` (the Terraform placeholder) counts as **not configured** for
`STRIPE_SECRET_KEY`, `RAZORPAY_KEY_SECRET`, `EVS_PLAYBACK_KEY`, `EVS_READ_KEY`,
`OPENAI_API_KEY` and `GEMINI_API_KEY`. It does **not** for the three webhook secrets:
replace those before enabling a gateway ([security.md](../architecture/security.md#known-limitations)).

## API and worker

### Runtime and HTTP

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production`. Production turns the guard's problems into a boot failure |
| `PORT` | `5026` | API listen port |
| `PRODUCT_NAME` | `Euron Open LMS` | Fallback academy name (emails, certificates) until `settings.academyName` is set |
| `APP_WEB_URL` | `http://localhost:3530` | The web app's public origin: emailed links, Stripe return URLs, certificate verify URLs, the origin sent to EVS, the CORS default |
| `PUBLIC_API_URL` | `http://localhost:5026` | The API's public origin; signed local-storage media URLs are built on it (`STORAGE=local`) |
| `CORS_ORIGINS` | empty (then `APP_WEB_URL`) | Comma-separated origins allowed with credentials; non-GET requests with another `Origin` get `403 CORS_ORIGIN_DENIED`. Required in production |
| `TRUST_PROXY` | `1` | Express `trust proxy` hop count (1 behind the ALB, 2 behind CloudFront and the ALB), so `req.ip` is the client |
| `LOG_LEVEL` | `info` | pino level: `fatal` to `trace`, or `silent` |
| `TZ` | set to `UTC` by the code | Pinned at the top of `index.ts`, `worker.ts` and `cli.ts` |

### Sessions and passwords

| Variable | Default | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | a committed development value | Signs access tokens. Production: 32+ characters, not the default |
| `REFRESH_SECRET` | a committed development value | Production: 32+ characters, different from `JWT_SECRET`. Also seeds the HMAC key of `STORAGE=local` media links |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh cookie and session lifetime |
| `COOKIE_SECURE` | `auto` | `auto` sets `Secure` when `APP_WEB_URL` is https; `true` or `false` to force |
| `BCRYPT_ROUNDS` | `12` | 4 to 15; the guard refuses below 12. The tests use 4 |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | Sign-up waits for the emailed link |
| `TOTP_ENCRYPTION_KEY` | derived from a public constant | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts TOTP secrets and keys the recovery-code HMAC. Required in production |
| `RATE_LIMITS` | on (off under `NODE_ENV=test`) | `off` disables every rate limit. Read on every call |
| `RATE_LIMIT_STORE` | `redis` (memory under `NODE_ENV=test`) | `redis` forces Redis-backed limits in tests |

### Database

Read by [`apps/api/src/db/connection-config.ts`](../../apps/api/src/db/connection-config.ts)
(also used by the migration runner).

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | unset (then `postgres://lms:lms@localhost:5492/lms`) | A static connection URL: local, CI, anything without password rotation. Wins over the secret mode |
| `DATABASE_SECRET_ARN` | unset | On AWS: the Secrets Manager secret (`{"username","password"}`) read for every new connection and cached 60 s, so a rotated password needs no restart |
| `DB_HOST`, `DB_NAME`, `DB_USER` | unset | Required with `DATABASE_SECRET_ARN` |
| `DB_PORT` | `5432` | |
| `DB_SSL` | `require` (secret mode) | `disable`, `require` (encrypt, no verification) or `verify-full` |
| `DB_SSL_CA_FILE` | unset | CA bundle for `verify-full` |
| `DB_POOL_MAX` | `10` | Pool size per process |
| `MIGRATE_ON_BOOT` | `false` | Run pending migrations when the API starts (under the advisory lock). The deployed stacks run them as a separate task |
| `MIGRATIONS_DIR` | `db/migrations` next to the runner | Read only by `db/migrate.ts` (the image sets `/app/db/migrations`) |

### Redis and jobs

| Variable | Default | Purpose |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6429` | BullMQ and rate limits. `rediss://:<token>@host:6379` on ElastiCache |
| `JOBS_MODE` | `queue` | `queue` (BullMQ, the worker runs handlers and schedules) or `inline` (handlers run in the API after commit; no retries, no schedules; refused in production) |

### Media storage

| Variable | Default | Purpose |
| --- | --- | --- |
| `STORAGE` | `local` | `s3` or `local` (files under `DATA_DIR/media`, signed URLs served by the API; refused in production) |
| `DATA_DIR` | `./data` | Local media and the mail outbox |
| `S3_BUCKET` | unset | Required with `STORAGE=s3` |
| `S3_REGION` | `AWS_REGION` | Bucket region |
| `S3_PUBLIC_ENDPOINT` | unset | Browser-reachable endpoint used for presigning when it differs from the one the API uses (the emulator: `http://localhost:4597`) |
| `AWS_REGION` | `us-east-1` | Default region for every AWS client |
| `AWS_ENDPOINT_URL` | unset | Points every AWS client at an emulator (Floci), with path-style S3 |
| `SIGNED_URL_TTL_SECONDS` | `900` | Lifetime of every presigned GET (media, invoices, certificates) |

AWS credentials come from the SDK's default chain (the ECS task role on AWS, `AWS_PROFILE`
or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` elsewhere).

### Mail

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAIL_MODE` | `outbox` | `outbox` (write `.eml` files to `DATA_DIR/outbox`; refused in production), `smtp` or `ses` |
| `MAIL_FROM` | unset | Sender, for example `Northwind Academy <no-reply@example.com>`. Required for `smtp` and `ses` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | unset, `587` | SMTP transport |
| `SES_REGION` | `AWS_REGION` | SES v2 region |
| `SES_CONFIGURATION_SET` | unset | Configuration set for sends (Terraform creates one) |

### AI

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `openai` | `openai`, `gemini`, `stub` (refused in production) or `none`. Without a usable key the AI features are hidden |
| `OPENAI_API_KEY` | unset | OpenAI (or compatible) key |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible server |
| `OPENAI_MODEL` | `gpt-4o-mini` | |
| `GEMINI_API_KEY` | unset | |
| `GEMINI_MODEL` | `gemini-2.5-flash` | |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | |
| `AI_STUB_URL` | `http://localhost:5119` | The stub server for `AI_PROVIDER=stub` |

### Payments

Setup: [payments.md](payments.md).

| Variable | Default | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | unset | Unset (or `set-me`) means Stripe is off |
| `STRIPE_PUBLISHABLE_KEY` | unset | Reported to the web app in `GET /api/meta` |
| `STRIPE_WEBHOOK_SECRET` | unset | `whsec_...` of the webhook endpoint; without it Stripe webhooks are refused |
| `STRIPE_API_BASE` | `https://api.stripe.com` | The stub locally; production warns when it is not the default |
| `RAZORPAY_KEY_ID` | unset | Unset means Razorpay is off |
| `RAZORPAY_KEY_SECRET` | unset | Basic auth and the Checkout.js signature |
| `RAZORPAY_WEBHOOK_SECRET` | unset | The secret you set on the Razorpay webhook |
| `RAZORPAY_API_BASE` | `https://api.razorpay.com` | The stub locally |
| `RAZORPAY_CHECKOUT_SCRIPT_URL` | `https://checkout.razorpay.com/v1/checkout.js` | Script the checkout page loads (the stub's `checkout.js` locally) |

### Video (euron-video-system)

Setup: [video-with-evs.md](video-with-evs.md).

| Variable | Default | Purpose |
| --- | --- | --- |
| `EVS_BASE_URL` | unset | The EVS API origin. Unset: EVS lectures answer `503 VIDEO_NOT_CONFIGURED` (other providers still play) |
| `EVS_PLAYBACK_KEY` | unset | API key with scope `playback:mint` |
| `EVS_READ_KEY` | unset | Optional, scope `videos:read`: the editor's video picker and status lookups |
| `EVS_WEBHOOK_SECRET` | unset | Verifies `video.ready` / `video.failed`; unset answers `503 EVS_WEBHOOK_NOT_CONFIGURED` |

### Demo

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEMO_PASSWORD` | random, printed once | `demo:seed` only: the password every demo account gets. The seed refuses `NODE_ENV=production` |

## Production guard

`assertProductionConfig()` lists problems; with `NODE_ENV=production` it throws
`Refusing to start with an insecure configuration`:

| Problem | Fix |
| --- | --- |
| `JWT_SECRET` / `REFRESH_SECRET` is the development default, shorter than 32 characters, or the two are equal | Generate two distinct random values |
| `TOTP_ENCRYPTION_KEY` is the development default | `openssl rand -base64 32` |
| `CORS_ORIGINS` is not set | The app URL |
| `APP_WEB_URL` points at localhost | The public URL |
| `STORAGE=local`, or `STORAGE=s3` without `S3_BUCKET` | Use S3 |
| `MAIL_MODE=outbox`, or no `MAIL_FROM` | Use `ses` or `smtp` with a sender |
| `JOBS_MODE=inline` | Use `queue` and run a worker |
| `AI_PROVIDER=stub` | `openai`, `gemini` or `none` |
| `BCRYPT_ROUNDS` below 12 | 12 or more |

`productionWarnings()` logs, without refusing: no payment gateway configured; Stripe or
Razorpay enabled without its webhook secret; `STRIPE_API_BASE` or `RAZORPAY_API_BASE` not
the real API. Outside production both lists are logged as warnings at boot.

## Web app

The web server reads its environment at run time; `NEXT_PUBLIC_*` values are only a
build-time fallback for `next dev`
([`apps/web/src/lib/runtime-env.ts`](../../apps/web/src/lib/runtime-env.ts),
[`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts),
[`apps/web/src/lib/server-api.ts`](../../apps/web/src/lib/server-api.ts)).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PRODUCT_NAME` (or `NEXT_PUBLIC_PRODUCT_NAME`) | `Euron Open LMS` | Product name in the wordmark and titles before the academy settings load; served to the browser in `/env.js` |
| `PUBLIC_API_URL` (or `NEXT_PUBLIC_API_URL`) | `/api` | API base for the browser, served in `/env.js`. Leave it unset: same origin |
| `API_INTERNAL_URL` | `http://localhost:5026` | Where server-side code (metadata, sitemap, JSON-LD) calls the API. The `/api/*` rewrite target is baked in at build time from the image build argument (`http://api:5026`); on AWS the ALB routes `/api/*` before it reaches Next |
| `APP_WEB_URL` | the request's host | Absolute URLs in metadata and the sitemap |
| `MEDIA_ORIGINS` | empty | Space- or comma-separated origins added to the CSP for uploads and signed media (the bucket, the emulator, a CDN) |
| `VIDEO_ORIGINS` | empty | Origins lecture video plays from (EVS API and media or CDN origins, HLS/MP4 hosts), added to `media-src`, `img-src` and `connect-src` |
| `NODE_ENV` | `production` in the image | `'unsafe-eval'` and `ws:` are added to the CSP outside production |
| `PORT`, `HOSTNAME` | `3000`, `0.0.0.0` in the image | Standalone server |

## Local compose stack

[`deploy/compose/compose.yaml`](../../deploy/compose/compose.yaml) sets every API value
under its own name with a `${NAME:-default}` interpolation, so the shell or an env file can
override it. `make env` writes `deploy/compose/.env`:

| Key | Becomes |
| --- | --- |
| `LMS_JWT_SECRET`, `LMS_REFRESH_SECRET`, `LMS_TOTP_ENCRYPTION_KEY` | `JWT_SECRET`, `REFRESH_SECRET`, `TOTP_ENCRYPTION_KEY` |
| `LMS_DEMO_PASSWORD` | `DEMO_PASSWORD` for `make demo` |
| `LMS_STRIPE_SECRET_KEY`, `LMS_STRIPE_WEBHOOK_SECRET` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` for both the API and the stubs |
| `LMS_RAZORPAY_KEY_SECRET`, `LMS_RAZORPAY_WEBHOOK_SECRET` | `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (key id `rzp_test_local`) |
| `LMS_EVS_PLAYBACK_KEY`, `LMS_EVS_WEBHOOK_SECRET` | `EVS_PLAYBACK_KEY` (also used as `EVS_READ_KEY`), `EVS_WEBHOOK_SECRET` |
| `LMS_*_PORT`, `LMS_PRODUCT_NAME`, `LMS_LOG_LEVEL` | Host ports and names |

Defaults set by the base file: `NODE_ENV=development`, `APP_WEB_URL`, `PUBLIC_API_URL` and
`CORS_ORIGINS` on `http://localhost:3530`, `COOKIE_SECURE=false`, `JOBS_MODE=queue`,
`MIGRATE_ON_BOOT=false`, `AI_PROVIDER=stub`, every gateway and EVS base URL on
`http://stubs:5119`, `RAZORPAY_CHECKOUT_SCRIPT_URL` and `VIDEO_ORIGINS` on
`http://localhost:5119`. The Floci overlay adds `STORAGE=s3`, `MAIL_MODE=ses`, the emulator
endpoints and `MEDIA_ORIGINS=http://localhost:4597`. To use a real provider, set its
variables in `deploy/compose/.env` ([`.env.example`](../../deploy/compose/.env.example)).

## Terraform inputs that become environment

[`infra/terraform/modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf)
builds the api and worker environment. Fixed values: `NODE_ENV=production`, `TZ=UTC`,
`PORT=5026`, `COOKIE_SECURE=true`, `JOBS_MODE=queue`, `STORAGE=s3`, `MAIL_MODE=ses`,
`DB_SSL=require`, `DATA_DIR=/tmp/data`, `MIGRATIONS_DIR=/app/db/migrations`.

The inputs below are the deployment module's. `envs/aws-dev` and `envs/aws-prod` expose a
subset in their `variables.tf` (domain, DNS and certificate, mail domain, product name,
image tag, CDN, alarm email, AI (`ai_provider`, `openai_model`), payments, EVS, video
origins, extra CORS origins, `log_level`, `require_email_verification`,
`api_extra_environment`, `api_extra_secrets`, instance classes, CPU architecture, the
application database role); `db_pool_max` and `migrate_on_boot` keep the module
defaults unless you pass them through in the env's `main.tf`.

| Input | Sets |
| --- | --- |
| `domain` | `APP_WEB_URL`, `PUBLIC_API_URL`, `CORS_ORIGINS` (`https://<domain>`) |
| `enable_cdn` | `TRUST_PROXY` (2 with CloudFront, else 1) |
| `product_name` | `PRODUCT_NAME`, the `MAIL_FROM` display name |
| `mail_domain` | `MAIL_FROM` address, `SES_CONFIGURATION_SET` |
| `log_level`, `require_email_verification`, `db_pool_max`, `migrate_on_boot`, `openai_model` | The matching variables |
| `ai_provider` | `AI_PROVIDER` (default `openai` when an OpenAI secret exists, else `none`) |
| `openai_api_key` / `create_openai_secret` | `OPENAI_API_KEY` from `<prefix>/openai` |
| `enable_stripe`, `stripe_publishable_key`, `stripe_secret_key`, `stripe_webhook_secret` | `STRIPE_PUBLISHABLE_KEY`; `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from `<prefix>/payments` |
| `enable_razorpay`, `razorpay_key_id`, `razorpay_key_secret`, `razorpay_webhook_secret` | `RAZORPAY_KEY_ID`; the two secrets from `<prefix>/payments` |
| `evs_base_url`, `evs_playback_key`, `evs_read_key`, `evs_webhook_secret` | `EVS_BASE_URL`; the three keys from `<prefix>/evs` |
| `video_origins` | the web app's `VIDEO_ORIGINS` (default: the origin of `evs_base_url`) |
| `app_db_secret_arn`, `app_db_username` | `DATABASE_SECRET_ARN`, `DB_USER` of the api and worker (default: the RDS master) |
| `api_extra_environment`, `api_extra_secrets` | Anything else, for example `GEMINI_API_KEY` |

Always injected from Secrets Manager: `JWT_SECRET`, `REFRESH_SECRET` (`<prefix>/app`),
`TOTP_ENCRYPTION_KEY` (`<prefix>/totp`) and `REDIS_URL` (`<prefix>/redis`). The database
password is never in the environment. The web service gets `PRODUCT_NAME`,
`API_INTERNAL_URL` (the app URL), `MEDIA_ORIGINS` (the bucket's two virtual-hosted S3
origins) and `VIDEO_ORIGINS`.

## Academy settings

Edited by an ADMIN at `/admin/settings` (`PATCH /api/admin/settings`), stored as one JSON
document, merged over the defaults in
[`apps/api/src/services/settings.service.ts`](../../apps/api/src/services/settings.service.ts),
cached 5 s per process and audited with the before and after values. Lists and the routing
map are replaced as a whole. Validation is in
[`apps/api/src/controllers/admin.controller.ts`](../../apps/api/src/controllers/admin.controller.ts) (`settingsPatch`).

| Setting | Default | Rule |
| --- | --- | --- |
| `academyName` | `PRODUCT_NAME` | 1 to 80 characters |
| `tagline` | "Learn by doing, at your own pace." | At most 160 |
| `logoUploadId` | null | A `BRANDING` upload |
| `registration` | `OPEN` | `OPEN` or `CLOSED` |
| `supportEmail` | null | |
| `currencies.enabled`, `currencies.default` | `["USD"]`, `USD` | 1 to 20 ISO 4217 codes; the default must be enabled |
| `gateways.routing`, `gateways.fallback` | `{ INR: RAZORPAY }`, `STRIPE` | Currency to gateway; Razorpay only takes INR |
| `tax.enabled`, `tax.mode`, `tax.rules` | off, `EXCLUSIVE`, none | Rules `{ country: "IN" or "*", rateBps: 0..10000, label }`, at most 250 |
| `seller.legalName`, `address`, `taxId`, `email` | `PRODUCT_NAME`, empty | Printed on invoices, frozen at issue |
| `learning.videoCompletePercent` | 90 | 1 to 100: share of a video watched to complete it |
| `learning.reviewMinProgressPercent` | 20 | 1 to 100: progress needed to review a course |
| `learning.subscriptionGraceDays` | 3 | 0 to 30: access kept after a failed renewal |
| `learning.orderTtlMinutes` | 60 | 5 to 1440: how long a pending order stays payable |
| `certificates.signatoryName`, `signatoryTitle`, `footer` | empty | Printed on certificates |
| `analytics.timezone` | `UTC` | IANA zone for the overview's days and the learner streak |
