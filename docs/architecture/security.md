# Security architecture

The controls in Euron Open LMS as built, where each lives in the code, and what is known
to be missing. The threats they answer are rated in [threat-model.md](threat-model.md).
Paths are relative to the repository root.

## 1. Authentication

- Passwords: bcrypt with `BCRYPT_ROUNDS` (12; the production guard refuses less), 10 to 128
  characters, not one repeated character, not containing the email local part or the
  username ([`apps/api/src/security/passwords.ts`](../../apps/api/src/security/passwords.ts)).
- Sign-in is throttled, never locked (a lock anyone can trigger is a denial of service
  against the owner): 5 failures per account and IP per 15 minutes and 50 per account per
  hour, in Redis. Once spent, every attempt answers `429 RATE_LIMITED`, right password or
  not, existing account or not. An unknown login burns a bcrypt compare against a dummy
  hash so timing does not reveal whether an email has an account
  ([`apps/api/src/services/auth.service.ts`](../../apps/api/src/services/auth.service.ts)).
- Email verification (`REQUIRE_EMAIL_VERIFICATION`, default on): a 24-hour single-use
  token, stored as SHA-256. Password reset tokens live one hour.
- Two-factor: TOTP (RFC 6238) with the secret encrypted at rest (AES-256-GCM, key derived
  with HKDF from `TOTP_ENCRYPTION_KEY`, the user id bound as associated data, so a
  ciphertext copied to another account does not decrypt); each code works once
  (`totp_last_step`); ten single-use recovery codes stored as HMACs
  ([`apps/api/src/security/totp.ts`](../../apps/api/src/security/totp.ts)).
- `admin:create` never sets or prints a password for an existing account and, for a new
  one, emails a set-password link instead of printing a password (stdout on ECS is
  CloudWatch Logs) ([`apps/api/src/services/admin-bootstrap.service.ts`](../../apps/api/src/services/admin-bootstrap.service.ts)).

## 2. Sessions, cookies and CSRF

- The access token (HS256 JWT, 15 minutes, audience and issuer checked, `sub` and `ver`)
  lives **only in browser memory**
  ([`apps/web/src/lib/session.ts`](../../apps/web/src/lib/session.ts)), never in
  `localStorage` or `sessionStorage`, where any injected script could lift it. This fixes a
  defect of the system this one replaces, which kept tokens in `localStorage`.
- The refresh token is 32 random bytes in the `lms_refresh` cookie: `httpOnly`,
  `SameSite=Lax`, `Path=/api/auth`, `Secure` when the app is served over https
  (`COOKIE_SECURE=auto`). Only its SHA-256 is stored. Each refresh rotates it; a rotated
  token presented again after 10 s revokes the whole family
  ([ADR 0005](adr/0005-refresh-rotation-cookie-and-memory-token.md)).
- Every request reloads the user row ([`apps/api/src/middleware/auth.ts`](../../apps/api/src/middleware/auth.ts)),
  so a ban, a deactivation, a password change or "sign out everywhere" (which bump
  `token_version`) takes effect on the next request.
- CSRF: the API authenticates with a bearer header, which a cross-site form cannot set.
  The cookie-authenticated endpoints (refresh, logout) sit behind `SameSite=Lax` and a
  second check: any non-GET request with an `Origin` outside `CORS_ORIGINS` is
  `403 CORS_ORIGIN_DENIED` ([`apps/api/src/app.ts`](../../apps/api/src/app.ts)).
- The web app serialises refreshes across tabs with the Web Locks API and single-flights
  them within a tab ([`packages/api-client/src/http.ts`](../../packages/api-client/src/http.ts)).

## 3. Authorisation

### Platform roles and `/admin` areas

[`apps/api/src/domain/admin-permissions.ts`](../../apps/api/src/domain/admin-permissions.ts):

| Area | ADMIN | SUPPORT | FINANCE | INSTRUCTOR |
| --- | --- | --- | --- | --- |
| overview | yes | yes | yes | yes (own courses) |
| courses | yes | yes (read every course) | | yes (own courses) |
| learners | yes | yes | | |
| grading | yes | yes | | yes (own courses) |
| orders | yes | yes (read; no refunds or cancels) | yes | |
| plans, coupons | yes | | yes | |
| certificates, moderation | yes | yes | | |
| staff, settings, audit | yes | | | |

Every admin service starts with `requireArea(actor, area)`, which also requires an ACTIVE
account: a suspended operator has no powers. Refunds and subscription cancels also need
`canRefund` (ADMIN, FINANCE). Role changes are ADMIN only, never on yourself, and the last
active admin cannot be demoted. Operators act on learners or on staff strictly below their
role, never on themselves, so an admin is never suspended, banned or erased from the
console.

### Course roles

`requireCourseStaff(actor, courseId, roles, { write })` in
[`apps/api/src/services/access.service.ts`](../../apps/api/src/services/access.service.ts):
ADMIN may do everything; SUPPORT reads every course; an instructor needs a `course_staff`
role on that course from the allowed list, and a course they are not on is 404 (they cannot
confirm it exists). A course role never changes a platform role.

### Ownership

Learner-owned rows are always filtered by the caller's id and answer 404 for anyone else:
orders, invoices and their PDFs, subscriptions, quiz attempts, submissions, notes,
bookmarks, notifications, certificate PDFs, sessions.

### Writes and mass assignment

- Every body schema is strict zod: unknown keys are `400 VALIDATION_FAILED`
  ([`apps/api/src/core/validate.ts`](../../apps/api/src/core/validate.ts)).
- Services write explicit field lists. Course PATCH never touches `status`, counters or
  `published_at`; settings fields need OWNER and `featured` needs ADMIN
  ([`apps/api/src/services/admin-course.service.ts`](../../apps/api/src/services/admin-course.service.ts)).
  Account PATCH takes only profile fields; role and status change only through the staff
  and learner consoles.
- This fixes the mass-assignment defect of the system this one replaces, where request
  bodies were spread into updates.

## 4. Course content and answer keys

- Who may open content is one pure function, `decideAccess`, reached through one service
  ([entitlements.md](entitlements.md)). Free enrollment is refused for anything but a
  published FREE course (`403 NOT_FREE`). The old system's always-truthy check and its free
  enroll of paid courses are the two defects this design was built to remove.
- Content routes need a session or a preview flag: there is no unauthenticated content
  endpoint except free preview lectures.
- Quiz answer keys live in the bank and in attempt snapshots; the attempt presenter is the
  only code that turns a snapshot into JSON, field by field, and adds the key only when the
  reveal policy allows ([assessments.md](assessments.md)). Grading reads only the snapshot,
  so foreign option ids or questions earn nothing.
- `lectures.video_ref` and PDF storage keys never appear in learner DTOs. Video is handed
  out as a playback session minted after the check; PDFs and resources as short-lived signed
  URLs after the check ([video.md](video.md)).

## 5. Payments integrity

([payments.md](payments.md))

- Amounts come only from the server's price book; the client sends item, currency and an
  optional coupon code. Money is integer minor units with its currency; the database checks
  that an order's total equals its parts.
- The currency must be one the academy enabled, priced explicitly; there is no conversion
  and no client-chosen amount.
- Webhooks: signature over the raw bytes first, in constant time, with a 300 s replay
  window for Stripe and EVS; then stored once (`payment_events (gateway, event_id)` unique);
  then processed. A redelivery does nothing.
- The captured amount and currency must equal the order's (`amountMatches`), for
  webhooks, the Razorpay return, the Stripe return sync and the reconcile job. Renewals must
  equal the subscription's amount.
- The Razorpay browser payload is verified (HMAC with the key secret over the order or
  subscription id and the payment id) and the payment is then fetched from Razorpay; the
  browser's word is never enough. Stripe's return URL carries only a session id and never
  fulfils by itself.
- Orders, refunds and subscriptions move by conditional updates under row locks; one
  fulfilment path for every source.
- Stored webhook payloads are redacted of card, bank, UPI, email, phone and address data
  ([`apps/api/src/services/payments/redact.ts`](../../apps/api/src/services/payments/redact.ts)).
- Refunds are capped by what is left on the order (pending refunds included) and by a
  database condition at settlement.

## 6. Input handling

- **Markdown** (course descriptions, articles, quiz prompts, instructions, submissions, Q&A,
  reviews) is rendered on the server with markdown-it and `html: false`: raw HTML is escaped,
  never passed through. Link and image URLs go through `safeUrl`; links get
  `rel="noopener noreferrer nofollow ugc"`; images are allowed only in staff-authored content
  ([`apps/api/src/domain/markdown.ts`](../../apps/api/src/domain/markdown.ts)). The old
  system rendered assignment markdown with raw HTML and no sanitiser.
- **URLs** (websites, resource links, submission links, HLS and MP4 refs) pass
  `safeUrl`: http(s) only, a real host, no credentials, no control characters, at most 500
  characters ([`apps/api/src/domain/safe-url.ts`](../../apps/api/src/domain/safe-url.ts)).
  Video refs and submission links must be https.
- **Display names** are cleaned of email addresses and phone numbers at write time
  ([`apps/api/src/domain/display-name.ts`](../../apps/api/src/domain/display-name.ts)).
- **Short-text answers** are capped at 500 characters; REGEX accepted answers must compile
  and are at most 200 characters.

## 7. Media

- Uploads go browser to bucket with a presigned PUT (600 s, content type and length
  signed). The declared type must be on the allowlist and match the extension; SVG, HTML,
  XML, JavaScript and executables are refused. After upload the API checks the stored size
  and the magic bytes; images are re-encoded (EXIF and GPS stripped) before anyone but the
  uploader sees them ([`apps/api/src/services/media.service.ts`](../../apps/api/src/services/media.service.ts)).
- Content attaches media by upload id only, after checking owner, purpose, status and that
  it is not attached elsewhere, under a row lock. The old system stored whatever file URL or
  storage key a client sent ([`apps/api/src/services/media-attach.service.ts`](../../apps/api/src/services/media-attach.service.ts)).
- The bucket is private (Block Public Access, SSE-KMS with the deployment key, TLS-only
  policy, versioning); every read is a presigned GET minted after the permission check,
  living `SIGNED_URL_TTL_SECONDS` (900). Invoice and certificate PDFs are served as
  attachments. Storage keys contain nothing from the client file name.
- `STORAGE=local` (development only, refused in production) signs URLs with an HMAC keyed
  from `REFRESH_SECRET`.

## 8. Privacy and account deletion

- `DELETE /api/users/me` (password and second factor) signs out everywhere and schedules
  erasure after 14 days; signing in again cancels it. A live subscription blocks it
  (cancel first, so the gateway stops charging).
- `anonymiseUser` keeps the user row because orders, invoices and enrollments reference it
  (financial records are kept), but replaces the email, username, names, bio, website and
  avatar, removes two-factor and the password, revokes sessions, and deletes notes,
  bookmarks, wishlist, quiz answers, submission text and files, and certificates. Reviews
  and Q&A stay under "Deleted user" ([`apps/api/src/services/account.service.ts`](../../apps/api/src/services/account.service.ts)).
- `GET /api/users/me/export` streams the caller's own data as JSON (3 per day).
- Email switches per category; receipts, refunds and security mail always go.
- What leaves the deployment: payment flows go to Stripe or Razorpay (the LMS sends the
  buyer's email and name to Stripe for the Customer); the learner's user id and the app
  origin go to EVS when a session is minted; assignment text and links go to the AI provider
  only when a grader asks for a suggestion; lesson text goes to it when an author drafts
  questions.

## 9. Headers and CSP

- API: Helmet with `default-src 'none'`, `frame-ancestors 'none'`, no `x-powered-by`.
- Web: a per-request CSP with a nonce and `strict-dynamic`
  ([`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts)): `default-src 'self'`;
  images, media and connect limited to `self`, `MEDIA_ORIGINS`, `VIDEO_ORIGINS` and
  Razorpay; frames limited to `youtube-nocookie.com`, the media origins (PDF lectures) and
  Razorpay; `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`. Static headers in [`apps/web/next.config.ts`](../../apps/web/next.config.ts):
  `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  a restrictive `Permissions-Policy` (payment only for self and Razorpay, fullscreen for
  the player) and `Cross-Origin-Opener-Policy: same-origin-allow-popups` (Razorpay UPI
  flows).

## 10. Rate limits

Per-route budgets in Redis shared by every task, keyed by user (or IP), with an in-memory
fallback per task during a Redis outage. The full table is in
[LLD.md](LLD.md#9-rate-limits). On AWS with the CDN, the WAF adds the AWS managed common and
known-bad-inputs rule sets and a per-IP limit of 2000 requests per 5 minutes; the common
rules skip `/api/webhooks/*` (customer text in webhook bodies trips them), which are
signature-verified instead ([`infra/terraform/modules/cdn/main.tf`](../../infra/terraform/modules/cdn/main.tf)).

## 11. Secrets and the production guard

`assertProductionConfig()` ([`apps/api/src/core/config.ts`](../../apps/api/src/core/config.ts))
refuses to boot with `NODE_ENV=production` when:

- `JWT_SECRET` or `REFRESH_SECRET` is the committed development default or shorter than 32
  characters, or the two are equal;
- `TOTP_ENCRYPTION_KEY` is the development default;
- `CORS_ORIGINS` is unset, or `APP_WEB_URL` points at localhost;
- `STORAGE=local`, or `STORAGE=s3` without `S3_BUCKET`;
- `MAIL_MODE=outbox`, or a real mail mode without `MAIL_FROM`;
- `JOBS_MODE=inline`, `AI_PROVIDER=stub`, or `BCRYPT_ROUNDS` below 12.

`productionWarnings()` only logs: no gateway configured, a gateway without its webhook
secret, `STRIPE_API_BASE` or `RAZORPAY_API_BASE` pointing away from the real API.

On AWS the secrets live in Secrets Manager, encrypted with the deployment's KMS key, and
are injected by ECS at task start: `<prefix>/app` (JWT and refresh secrets, generated),
`<prefix>/totp`, `<prefix>/redis` (the `REDIS_URL` with its AUTH token), and when enabled
`<prefix>/openai`, `<prefix>/payments` and `<prefix>/evs`, created with `set-me`
placeholders ([`infra/terraform/modules/secrets/main.tf`](../../infra/terraform/modules/secrets/main.tf)).
The database password is read from the RDS-managed secret per new connection, so it is
never in the environment. A key equal to `set-me` counts as not configured for the
Stripe and Razorpay secret keys, the EVS keys, OpenAI and Gemini.

## 12. Logging

pino JSON logs with a request id on every line; secret-bearing fields (passwords, tokens,
TOTP codes, recovery codes, cookies, authorization headers) are redacted at any of three
nesting levels ([`apps/api/src/core/logger.ts`](../../apps/api/src/core/logger.ts)). Signed
local media tokens are masked in access log URLs. A 500 returns only the request id;
the error is logged with it. Gateway error messages are trimmed to 200 characters and
never contain the secret.

## 13. Infrastructure controls

From [`infra/terraform/modules`](../../infra/terraform/modules):

- Tasks in private subnets, no public IPs, security groups allowing ingress only from the
  ALB; ECS Exec disabled; read-only root filesystem with a writable `/tmp`; deployment
  circuit breaker with rollback.
- One task role per service with least privilege: the api and worker may read and write
  objects in the media bucket, use the KMS key through S3 and Secrets Manager only, send
  mail through the deployment's SES identity, and read the database secret. The migrate
  task may read only the master database secret.
- RDS: private, encrypted with the CMK, `rds.force_ssl`, RDS-managed rotating master
  password, Performance Insights, automated backups, deletion protection in aws-prod.
- ElastiCache: TLS in transit (required), AUTH token, encrypted at rest, `noeviction`.
- ALB: TLS policy `ELBSecurityPolicy-TLS13-1-2-2021-06`, HTTP redirects to HTTPS, unknown
  hosts get a fixed response; with the CDN, a secret origin header is required.
- VPC flow logs and CloudWatch log groups encrypted with the CMK; alarms on 5xx, unhealthy
  targets, CPU, memory, database CPU, storage and connections, Redis memory, and failed
  background jobs.
- An optional least-privilege database role for the api and worker
  ([operations.md](../guides/operations.md#least-privilege-database-role)).

## 14. Supply chain and CI

- `.github/workflows/checks.yml` runs on every push: lint, typecheck, unit tests, the
  OpenAPI drift check, the sanitization scan
  ([`scripts/check-sanitization.sh`](../../scripts/check-sanitization.sh): credentials,
  account ids, real emails, public IPs, committed env files), Terraform fmt and validate.
- `.github/workflows-full/` (opt-in for forks) adds integration tests, gitleaks over the full
  history, CodeQL, `pnpm audit --prod --audit-level=high`, tflint, checkov, multi-arch image
  builds and the e2e run.
- Images are pinned by version (`node:22.23.4-bookworm-slim`, `postgres:16.12-alpine`,
  `redis:7.4-alpine`, `floci/floci:2.3.0`); the API image runs as `node`.

## Known limitations

Webhook secrets equal to the Terraform placeholder `set-me` are refused like an unset
secret (`isRealKey` in `apps/api/src/core/config.ts`): the gateway's webhook then fails
signature checks until a real secret is in place, so the public placeholder can never
sign an event.

| Limitation | Impact | Status |
| --- | --- | --- |
| `STRIPE_API_BASE` / `RAZORPAY_API_BASE` pointing at a stub is only a warning in production | Payments would go to a fake | Accepted: a warning at every boot (`productionWarnings`) and the mode reads "stub" in Settings, Integrations |
| Signing out one session revokes its refresh family but not the access token already issued | Usable for up to 15 minutes | Accepted |
| `TOTP_ENCRYPTION_KEY` cannot be rotated in place | Replacing it forces every two-factor user to enrol again | Accepted |
| Author-supplied REGEX answers run with no time limit | A malicious instructor could write a catastrophically backtracking pattern; input is capped at 500 characters and patterns at 200 | Low, open |
| Uploads are type-checked and images re-encoded, but documents, archives and audio are not malware-scanned | A learner could submit a malicious file to a grader | Medium, open; graders download as attachments |
| HLS and MP4 lecture URLs are handed out as stored | Shareable if the host makes them public | Accepted; use EVS for protected video |
| AI grading suggestions see learner text | Prompt injection can skew a draft | Low: drafts are never applied ([ADR 0017](adr/0017-ai-drafts-never-auto-applied.md)) |
| Receipts and refund emails are not deduplicated | A retried job can send a second email | Low |
| Rate limits during a Redis outage are per task | The effective budget multiplies by the task count | Accepted |
| No antivirus, DLP or anomaly detection on payments beyond the amount check | | Accepted |
