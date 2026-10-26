# Low-level design

How the API is organised: the layers and the conventions every module follows, auth and
sessions, the modules one by one, the pure domain functions, background jobs, rate limits
and errors. The system view is in [HLD.md](HLD.md); tables are in
[data-model.md](data-model.md). Paths are relative to the repository root; `api/` below
means `apps/api/src/`.

## 1. Layout

```
apps/api/src/
  index.ts            HTTP entry: config guard, optional migrate, register jobs, listen, drain
  worker.ts           BullMQ entry: one Worker per queue, the repeatable schedules
  cli.ts              admin:create, demo:seed
  app.ts              createApp(): middleware, webhooks (raw body), routes, error handler
  core/               config, context (Actor, requireArea), effects, errors, ids, cursor,
                      validate, logger, aws client config
  db/                 kysely.ts (pool, types init), connection-config.ts, types.ts (generated)
  domain/             pure rules, no I/O (section 5)
  routes/             one file per mount; index.ts is the MOUNTS table
  controllers/        zod parse, call one service, send
  services/           business rules, transactions, effects
    payments/         gateway interface, stripe, razorpay, webhook, fulfilment, redact
  repositories/       Kysely queries; every method takes an optional Executor
  presenters/         rows to DTOs from @open-lms/types, batched
  integrations/       evs, storage (s3 | local), mail (outbox | smtp | ses), redis, ai/
  jobs/               registry.ts plus one file per module (section 8)
  security/           passwords (bcrypt), tokens (JWT, refresh), totp
  middleware/         auth, rate-limit, http helpers
  demo/               the demo academy seed
apps/web/src/         Next.js app router pages, components, lib (api client wiring, session)
packages/types        DTOs and enums shared by api and web
packages/api-client   typed HTTP client (single-flight refresh, cross-tab lock, uploads)
packages/ui           components and tokens
apps/stubs            Stripe, Razorpay, OpenAI and EVS stand-ins (local and tests)
db/                   migrate.ts and migrations/0001_init.sql
```

## 2. Layers and conventions

The layering is the one in [ADR 0003](adr/0003-layered-repository-pattern.md):

| Layer | Does | Never does |
| --- | --- | --- |
| Route (`routes/*.routes.ts`) | Declares `router.<method>(path, ...guards, ctrl.fn)` with a doc comment; guards are `authenticate`, `optionalAuth` and `rateLimit(name, points, seconds, by)` | Business logic. `scripts/gen-openapi.ts` reads these files, so one statement per route |
| Controller (`controllers/`) | `parse(schema, req.body / query / params)` with strict zod schemas, `actorOf(req)`, one service call, status code | Reads the database |
| Service (`services/`) | Takes an `Actor` (never a request), applies rules, opens `withTransaction`, calls repositories, presenters and `notify`, queues effects, writes the audit row | Builds SQL by hand when a repository method exists (a few small reads are inline) |
| Domain (`domain/`) | Pure functions over plain facts | I/O of any kind |
| Repository (`repositories/`) | Kysely queries, conditional updates, row locks; accepts `exec: Executor = db` so callers pass a transaction | Decides access |
| Presenter (`presenters/`) | Rows to DTOs, field by field, batching related lookups (media signing, user summaries) | Spreads a row into a DTO (a new column must never leak by accident) |

Conventions that hold everywhere:

- **Identity comes from the token.** No body field names the acting user. A service gets
  `Actor { id, username, displayName, role, status }` from `middleware/auth.ts`.
- **Writes need an ACTIVE account.** `requireActive(actor)` refuses SUSPENDED accounts with
  `403 ACCOUNT_RESTRICTED`; suspended learners can still read and keep watching
  ([`core/context.ts`](../../apps/api/src/core/context.ts)).
- **Strict input.** Every body schema is `.strict()`: an unknown key is
  `400 VALIDATION_FAILED` with `details.fields`. This is the guard against mass assignment
  (a client cannot send `status`, `role`, `amountMinor` or `userId`).
- **Not found over forbidden for things you may not know exist**: someone else's order,
  attempt, note, invoice or certificate PDF, a draft course for a learner, a course an
  instructor is not on are all 404.
- **Conditional updates for state machines.** Orders, subscriptions, attempts, submissions,
  enrollments, refunds, certificates and account statuses move with
  `UPDATE ... WHERE status = <expected>` and check the row count; the loser of a race gets a
  409 or a no-op, never a double effect.
- **Lock order.** Fulfilment, refunds and refund settlement lock the `orders` row first;
  curriculum writes and the EVS webhook lock the `courses` row (in id order when several);
  progress writes lock the learner's `enrollments` row.
- **Counters move in the same transaction** as the rows they count, and
  `maintenance.reconcile-counters` fixes drift.
- **Audit inside the transaction**: `audit()` ([`services/audit.service.ts`](../../apps/api/src/services/audit.service.ts))
  is called with the transaction, so a rolled-back change leaves no entry.
- **Effects after commit** ([ADR 0007](adr/0007-after-commit-effects.md)).

## 3. Auth and sessions

| Piece | Where | Rule |
| --- | --- | --- |
| Passwords | [`security/passwords.ts`](../../apps/api/src/security/passwords.ts) | bcrypt (`BCRYPT_ROUNDS`, 12); 10 to 128 characters, not one repeated character, not containing the email local part or username |
| Access token | [`security/tokens.ts`](../../apps/api/src/security/tokens.ts) | HS256 JWT, `sub` + `ver` (`token_version`), audience `open-lms`, issuer `open-lms-api`, `ACCESS_TOKEN_TTL_SECONDS` (900). Kept in browser memory only ([`apps/web/src/lib/session.ts`](../../apps/web/src/lib/session.ts)) |
| Refresh token | [`controllers/auth.controller.ts`](../../apps/api/src/controllers/auth.controller.ts) | 32 random bytes in the `lms_refresh` cookie: `httpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Secure` per `COOKIE_SECURE`, `REFRESH_TOKEN_TTL_DAYS` (30). Only its SHA-256 is stored in `sessions` |
| Rotation | [`services/auth.service.ts`](../../apps/api/src/services/auth.service.ts) | Each refresh issues a new token in the same `family_id`. A rotated token presented 10 s or more after its rotation revokes the family and audits `session.reuse_detected`; within 10 s it is a benign double refresh |
| Sign-in throttling | same | Two failure budgets in Redis: 5 per account and IP per 15 minutes, 50 per account per hour. Once spent, every attempt answers `429 RATE_LIMITED`, right password or not; unknown logins are counted and burn a bcrypt compare so timing does not reveal accounts |
| Two-factor | [`security/totp.ts`](../../apps/api/src/security/totp.ts) | TOTP secrets AES-256-GCM encrypted with a key derived from `TOTP_ENCRYPTION_KEY`, the user id as associated data; a code works once (`totp_last_step`); ten recovery codes stored as HMACs |
| Email verification | `auth.service.ts` | `REQUIRE_EMAIL_VERIFICATION` (default true): signup answers 202 and the account is `PENDING_VERIFICATION` until the 24 h link is used |
| Registration | `settings.registration` | `OPEN` or `CLOSED` (`403 REGISTRATION_CLOSED`) |

## 4. Modules

### 4.1 Catalog

[`services/catalog.service.ts`](../../apps/api/src/services/catalog.service.ts),
[`repositories/catalog.repository.ts`](../../apps/api/src/repositories/catalog.repository.ts),
[`presenters/course-card.presenter.ts`](../../apps/api/src/presenters/course-card.presenter.ts).

- Only PUBLISHED courses are listed; search uses the generated `courses.search` tsvector
  and a trigram index on the title; sorts are relevance, popular, newest, rating and price.
- Facets count each dimension ignoring its own filter.
- `CourseDetail.access` is computed on the server from `decide()` (the entitlement
  decision) plus the price book: `ENROLLED`, `FREE`, `INCLUDED_IN_PLAN`, `PURCHASABLE`,
  `SUBSCRIPTION_REQUIRED`, `STAFF`, `LAPSED` (with the reason), `UNAVAILABLE` or
  `SIGNED_OUT` ([`packages/types/src/learning.ts`](../../packages/types/src/learning.ts)).
  The web app only renders it.
- Display prices are in `?currency=`, else the viewer's `preferred_currency`, else the
  academy default, and only in enabled currencies.
- `POST /api/catalog/courses/:slug/enroll` is for FREE courses only (`403 NOT_FREE`); it
  goes through `grantEnrollment` and returns the same enrollment when called again.

### 4.2 Authoring (the `/admin` course editor)

[`services/admin-course.service.ts`](../../apps/api/src/services/admin-course.service.ts),
[`services/curriculum.service.ts`](../../apps/api/src/services/curriculum.service.ts),
[`services/question.service.ts`](../../apps/api/src/services/question.service.ts),
[`services/authoring-access.service.ts`](../../apps/api/src/services/authoring-access.service.ts),
[`domain/authoring-rules.ts`](../../apps/api/src/domain/authoring-rules.ts).

- Rights: ADMIN everything; SUPPORT reads every course; an INSTRUCTOR sees only the courses
  they are staff on (anything else 404). OWNER manages settings, prices, staff, status and
  delete; EDITOR edits content; GRADER reads. A visible course without the right is
  `403 COURSE_ROLE_REQUIRED`.
- PATCH takes an explicit field list and never touches status, counters or `published_at`.
  Status moves (`publish`, `unpublish`, `archive`) are separate conditional updates.
- Publish runs `publishChecklist` inside the transaction that holds the course lock: at
  least one item, a cover, a description of 30+ characters, a price when PAID, every video
  lecture with a READY video, every quiz with questions. Anything on the list is
  `422 PUBLISH_BLOCKED` with `details.checklist`.
- Slugs come from the title and are made unique with `-2`, `-3`, ...; a concurrent create
  that hits the unique index retries with the next suffix.
- Curriculum writes take the course row lock, compute the new order with
  [`domain/curriculum.ts`](../../apps/api/src/domain/curriculum.ts) and write every sibling
  position with the unique constraints deferred. Limits: 100 sections, 1000 items, 20
  resources per lecture. Every id from the body is checked against the course.
- `item_count` and `duration_seconds` on the course are recounted in the same transaction.
- EVS lookups (an HTTP call) happen before the transaction opens.
- Prices replace the course's active one-time prices; old rows are deactivated, never
  deleted, because orders point at them.
- Questions are validated per kind (`normaliseQuestion`) and get server-made option ids;
  deleting one a quiz uses archives it instead.

### 4.3 Classroom

[`services/classroom.service.ts`](../../apps/api/src/services/classroom.service.ts),
[`services/playback.service.ts`](../../apps/api/src/services/playback.service.ts),
[`services/progress.service.ts`](../../apps/api/src/services/progress.service.ts),
[`services/note.service.ts`](../../apps/api/src/services/note.service.ts).

Every entry point calls `requireCourseAccess` or `requireItemAccess` first
([entitlements.md](entitlements.md)). Item content is rendered on the server: article and
note HTML through `renderAuthored`, PDFs as signed URLs, quizzes as an overview without
questions, assignments with the learner's own submissions. Video playback is a separate
POST that mints the session ([video.md](video.md)). Progress writes are refused for free
previews (`409 PREVIEW`) and for staff browsing without an enrollment
(`409 STAFF_PREVIEW`). Details: [progress-and-certificates.md](progress-and-certificates.md).

### 4.4 Assessments

[`services/quiz.service.ts`](../../apps/api/src/services/quiz.service.ts),
[`services/submission.service.ts`](../../apps/api/src/services/submission.service.ts),
[`services/grading.service.ts`](../../apps/api/src/services/grading.service.ts). Snapshots,
grading, attempt policy, timers, reveal, rubrics and AI suggestions are in
[assessments.md](assessments.md).

### 4.5 Community

- Reviews ([`services/review.service.ts`](../../apps/api/src/services/review.service.ts)):
  a learner with current access whose progress reached
  `settings.learning.reviewMinProgressPercent` (20); one per learner per course; rating
  counters move in the same transaction; OWNER or EDITOR (or an admin) may reply.
- Q&A ([`services/qa.service.ts`](../../apps/api/src/services/qa.service.ts)): needs course
  access; a thread may name an item of the same course; replies by course staff or
  ADMIN/SUPPORT are marked `is_staff`; the asker or staff accept one answer.
- Reports and moderation ([`services/report.service.ts`](../../apps/api/src/services/report.service.ts),
  [`services/moderation.service.ts`](../../apps/api/src/services/moderation.service.ts)): one
  report per reporter per target; HIDE, RESTORE or DISMISS closes every open report on the
  target and adjusts the counters. The playbook is
  [grading-and-moderation.md](../guides/grading-and-moderation.md).
- All community text is rendered with `renderCommunity` (no raw HTML, no images).

### 4.6 Commerce

[`services/checkout.service.ts`](../../apps/api/src/services/checkout.service.ts),
[`services/payments/`](../../apps/api/src/services/payments/gateway.ts),
[`services/subscription.service.ts`](../../apps/api/src/services/subscription.service.ts),
[`services/refund.service.ts`](../../apps/api/src/services/refund.service.ts),
[`services/invoice.service.ts`](../../apps/api/src/services/invoice.service.ts),
[`services/billing.service.ts`](../../apps/api/src/services/billing.service.ts). The whole
flow is in [payments.md](payments.md).

### 4.7 Learners, enrollments and certificates (admin)

- [`services/admin-learners.service.ts`](../../apps/api/src/services/admin-learners.service.ts):
  search, the learner detail (each enrollment with whether it grants access now), grants
  (source GRANT, never shortening existing access), revokes, end-date changes, suspend
  (1 to 365 days), ban (sessions revoked, `token_version` bumped), erase. An operator acts
  only on learners or staff strictly below their own role, never on themselves.
- [`services/enrollment.service.ts`](../../apps/api/src/services/enrollment.service.ts): the
  only code that inserts or revokes enrollments.
- [`services/admin-certificates.service.ts`](../../apps/api/src/services/admin-certificates.service.ts):
  revoke with a reason, restore.

### 4.8 Staff, settings, stats, audit

- [`services/staff.service.ts`](../../apps/api/src/services/staff.service.ts): platform
  role changes (ADMIN only); nobody changes their own role; the last ACTIVE admin cannot be
  demoted (admin rows are locked before the check).
- [`services/settings.service.ts`](../../apps/api/src/services/settings.service.ts): one JSON
  document under `settings.key = 'academy'`, merged over `DEFAULT_SETTINGS`, cached 5 s per
  process. [`services/admin-settings.service.ts`](../../apps/api/src/services/admin-settings.service.ts)
  validates the merged result and audits the before and after of each changed group. The
  groups are listed in [configuration.md](../guides/configuration.md#academy-settings).
- [`services/admin-stats.service.ts`](../../apps/api/src/services/admin-stats.service.ts):
  the overview for a date range (at most 366 days) in `settings.analytics.timezone`;
  revenue and MRR per currency, never summed across currencies; instructors see their own
  courses.
- `GET /api/admin/integrations` reports gateway modes, EVS, AI, mail and storage without
  ever returning a key.

### 4.9 Account

[`services/account.service.ts`](../../apps/api/src/services/account.service.ts): deletion
with a 14-day grace (signing in again cancels it), `anonymiseUser`, and the JSON export.
A live subscription blocks deletion (`409 SUBSCRIPTION_ACTIVE`), as does being the last
active admin.

### 4.10 Media

[`services/media.service.ts`](../../apps/api/src/services/media.service.ts),
[`domain/media-rules.ts`](../../apps/api/src/domain/media-rules.ts),
[`services/media-attach.service.ts`](../../apps/api/src/services/media-attach.service.ts).
Purposes and the kinds each accepts:

| Purpose | Kinds |
| --- | --- |
| `AVATAR`, `COURSE_COVER`, `BRANDING` | IMAGE |
| `LECTURE_PDF` | PDF |
| `LECTURE_RESOURCE` | PDF, DOCUMENT, IMAGE, ARCHIVE, AUDIO |
| `SUBMISSION` | PDF, DOCUMENT, IMAGE, ARCHIVE, AUDIO, VIDEO |

Limits per kind: IMAGE 15 MB, VIDEO 200 MB, AUDIO 50 MB, PDF 25 MB, DOCUMENT 25 MB,
ARCHIVE 50 MB. SVG, HTML, XML, JavaScript and executables are refused by type and by
extension. The presigned PUT lives 600 s and signs content type and length; `complete`
checks the stored size and the magic bytes; `media.process` re-encodes images. Content
references media by upload id only, claimed under `FOR UPDATE` (owner, purpose, status,
not already attached). Storage keys are `media/<purpose>/<yyyy>/<mm>/<id>.<ext>`
([ADR 0008](adr/0008-presigned-uploads-by-upload-id.md)).

### 4.11 Notifications

[`services/notification.service.ts`](../../apps/api/src/services/notification.service.ts):
`notify()` writes the row inside the caller's transaction (never to yourself; the same
recipient, actor, type and entity within an hour updates the existing row) and queues
`notify.email` after commit. Email categories a learner can switch off: `LEARNING`,
`COMMUNITY`, `BILLING_REMINDERS` (failed orders, renewals), `PRODUCT_UPDATES`. Receipts,
refunds, subscription payment failures and cancellations, access changes and security
mail have no switch (`EMAIL_CATEGORY` maps them to null). `ORDER_PAID` and `REFUND_ISSUED` have
their own emails (`notify.receipt`, `notify.refund`) and are skipped by the sweep.

### 4.12 AI

[`integrations/ai/`](../../apps/api/src/integrations/ai/index.ts): one port
(`json({ name, schema, system, user })`), three providers (OpenAI-compatible, Gemini, the
stub) and `none`. [`integrations/ai/tasks.ts`](../../apps/api/src/integrations/ai/tasks.ts)
holds the three tasks (`draftQuestions`, `suggestGrade`, `polish`) with strict JSON
schemas and sanitisers. Learner text is fenced and labelled as data. Nothing the model
returns is saved without a person ([ADR 0011](adr/0011-pluggable-ai-providers.md),
[ADR 0017](adr/0017-ai-drafts-never-auto-applied.md)).

## 5. Domain functions

Every rule worth arguing about is a pure function with a unit test in
[`apps/api/test/unit`](../../apps/api/test/unit):

| Function | File | Decides |
| --- | --- | --- |
| `decideAccess`, `subscriptionGrantsAccess`, `canSelfEnrollFree` | [`domain/entitlements.ts`](../../apps/api/src/domain/entitlements.ts) | Who may open course content ([entitlements.md](entitlements.md)) |
| `price`, `couponDiscount`, `allocate`, `couponProblem`, `taxRuleFor`, `minorExponent` | [`domain/pricing.ts`](../../apps/api/src/domain/pricing.ts) | Checkout arithmetic in integer minor units |
| `canMove`, `sourcesOf`, `statusAfterRefund`, `amountMatches`, `orderNumber`, `certificateSerial` | [`domain/orders.ts`](../../apps/api/src/domain/orders.ts) | The order state machine and the amount check |
| `applyBeat`, `videoComplete`, `coursePercent`, `streak` | [`domain/progress.ts`](../../apps/api/src/domain/progress.ts) | Watched time from heartbeats and course completion |
| `buildSnapshot`, `grade`, `isCorrect`, `textMatches`, `cleanAnswers`, `mayReveal`, `isOverdue` | [`domain/quiz.ts`](../../apps/api/src/domain/quiz.ts) | Quiz attempts |
| `clampScores`, `canReview`, `canSubmitNewVersion`, `dueAt`, `validRubric` | [`domain/rubric.ts`](../../apps/api/src/domain/rubric.ts) | Assignment reviews |
| `normaliseQuestion`, video ref checks, `publishChecklist`, `withCriterionIds` | [`domain/authoring-rules.ts`](../../apps/api/src/domain/authoring-rules.ts) | Authoring |
| `moveWithin`, `moveAcross`, `neighbours`, `resumeTarget` | [`domain/curriculum.ts`](../../apps/api/src/domain/curriculum.ts) | Ordering and navigation |
| `renderAuthored`, `renderCommunity`, `plainText` | [`domain/markdown.ts`](../../apps/api/src/domain/markdown.ts) | Markdown to safe HTML |
| `safeUrl`, `youtubeId` | [`domain/safe-url.ts`](../../apps/api/src/domain/safe-url.ts) | Which URLs survive |
| `checkDeclared`, sniffers, `storageKeyFor` | [`domain/media-rules.ts`](../../apps/api/src/domain/media-rules.ts) | Uploads |
| `canOpenArea`, `permissionsFor`, `seesAllCourses`, `canRefund` | [`domain/admin-permissions.ts`](../../apps/api/src/domain/admin-permissions.ts) | `/admin` areas |
| `cleanDisplayName`, `isReservedUsername`, `slugify` | [`domain/display-name.ts`](../../apps/api/src/domain/display-name.ts), [`domain/username.ts`](../../apps/api/src/domain/username.ts), [`domain/slug.ts`](../../apps/api/src/domain/slug.ts) | Names |

## 6. Presenters and what each viewer sees

- Presenters build DTOs field by field. The attempt presenter
  ([`presenters/attempt.presenter.ts`](../../apps/api/src/presenters/attempt.presenter.ts))
  is the only code that turns a quiz snapshot (which holds the answer key) into JSON, and
  includes correct options, accepted answers and explanations only when `mayReveal` says so.
- Lecture `video_ref` never appears in any DTO except the admin item editor; learners get
  a `Playback` only from the playback route.
- Media is signed per response after the permission check (`loadMedia` in
  [`presenters/media.presenter.ts`](../../apps/api/src/presenters/media.presenter.ts)).
- Money is always `{ amountMinor, currency }` (`money()` in
  [`repositories/price.repository.ts`](../../apps/api/src/repositories/price.repository.ts)).

## 7. Keyset pagination

Lists return `Page<T>` (`{ items, nextCursor }`), never a total. Limit 1 to 50, default 20
([`core/validate.ts`](../../apps/api/src/core/validate.ts) `pageQuery`). Two cursor
encodings exist: [`core/cursor.ts`](../../apps/api/src/core/cursor.ts) (`iso|id` from a JS
`Date`, exact because columns are `timestamptz(3)`) and
[`repositories/keyset.ts`](../../apps/api/src/repositories/keyset.ts) (JSON arrays; the
time cursor reads the column as exact UTC text with `atKey`). A malformed cursor is
`400 INVALID_CURSOR`. Some small, bounded lists are plain arrays (categories, plans, a
learner's own submissions to one assignment, certificates). See
[ADR 0004](adr/0004-keyset-pagination.md).

## 8. Background jobs

The registry ([`jobs/registry.ts`](../../apps/api/src/jobs/registry.ts)) maps a job name to
a handler and the queue is the name's first segment. Defaults: 5 attempts, exponential
backoff from 5 s, the last 1000 completed and 5000 failed jobs kept. Registration is in
[`jobs/index.ts`](../../apps/api/src/jobs/index.ts).

| Job | Queue | Enqueued by | Handler | Idempotent because |
| --- | --- | --- | --- | --- |
| `media.process` | media | `completeUpload` | `processUpload` ([`services/media.service.ts`](../../apps/api/src/services/media.service.ts)) | Status transitions are guarded |
| `notify.email` | notify | `notify()` after commit (one id), and the 5-minute schedule (sweep) | `emailNotifications` ([`jobs/maintenance.jobs.ts`](../../apps/api/src/jobs/maintenance.jobs.ts)) | Each row is claimed (`emailed_at` set where NULL) before sending |
| `notify.receipt` | notify | Fulfilment and renewals | `sendReceipt` ([`jobs/billing.jobs.ts`](../../apps/api/src/jobs/billing.jobs.ts)) | Not deduplicated: a retried job can send a second receipt |
| `notify.refund` | notify | Refund settlement | `sendRefund` | Same |
| `invoices.render` | invoices | Fulfilment, renewals, refund settlement | `renderInvoice` ([`services/invoice.service.ts`](../../apps/api/src/services/invoice.service.ts)) | Skips an invoice that has a `pdf_key`; `setPdfKey` only writes NULL rows |
| `certificates.render` | certificates | Certificate issue | `renderCertificate` ([`services/certificate.service.ts`](../../apps/api/src/services/certificate.service.ts)) | Same pattern |
| `billing.reconcile-pending` | billing | Schedule, 10 min | `reconcilePending` ([`services/payments/fulfilment.service.ts`](../../apps/api/src/services/payments/fulfilment.service.ts)) | Goes through `fulfilOrder` / `closeOrder`, which lock and re-check |
| `billing.expire-subscriptions` | billing | Schedule, 30 min | `expireSubscriptions` ([`services/subscription.service.ts`](../../apps/api/src/services/subscription.service.ts)) | Conditional updates |
| `ai.grade-suggestion` | ai | Registered, not enqueued by any code path today (the route generates the draft synchronously) | `generateSuggestion` ([`jobs/assessment.jobs.ts`](../../apps/api/src/jobs/assessment.jobs.ts)) | Overwrites the draft |
| `maintenance.expire-uploads` | maintenance | Schedule, 30 min | `expireUploads` | Re-checks references in the DELETE |
| `maintenance.lift-suspensions` | maintenance | Schedule, 5 min | `liftSuspensions` | Conditional update |
| `maintenance.reconcile-counters` | maintenance | Schedule, 6 h | `reconcileCounters` | Updates only rows whose value `IS DISTINCT FROM` the recount |
| `maintenance.purge-accounts` | maintenance | Schedule, 6 h | `purgeAccounts` | Re-checks each account under a row lock |

Worker concurrency: 8 for `notify`, 4 for every other queue, per worker task. With
`JOBS_MODE=inline` handlers run in the API after commit with no retries and no schedules.

## 9. Rate limits

Redis-backed ([`middleware/rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts),
`rate-limiter-flexible`), keyed by user when signed in and by IP otherwise (or always by
IP where marked). During a Redis outage each limiter falls back to an in-memory limiter
with the same budget, enforced per task. `RATE_LIMITS=off` disables them (the default
under `NODE_ENV=test`). A spent budget answers `429 RATE_LIMITED` with `Retry-After`.

| Name | Budget | Routes |
| --- | --- | --- |
| `auth` (IP) | 10 per minute | signup, verify-email, login, reset-password, change-password, TOTP enable/disable/recovery codes |
| `auth-mail` (IP) | 5 per hour | resend-verification, forgot-password |
| `auth-refresh` (IP) | 60 per minute | refresh |
| login failure budgets | 5 per account and IP per 15 min; 50 per account per hour | login (section 3) |
| `account-delete` | 5 per hour | `DELETE /users/me` |
| `account-export` | 3 per day | `GET /users/me/export` |
| `media-create` | 60 per 10 min | create upload |
| `catalog-enroll` | 60 per hour | free enroll |
| `catalog-save` | 300 per hour | wishlist |
| `learn-playback` | 120 per hour | mint playback |
| `learn-progress` | 240 per hour | video heartbeats |
| `learn-complete` | 240 per hour | mark done |
| `learn-bookmark`, `learn-notes` | 300 per hour each | bookmarks, notes |
| `quiz-start` | 60 per 10 min | start attempt |
| `quiz-autosave` | 600 per 10 min | autosave |
| `assignment-submit` | 30 per hour | submissions |
| `review-write` | 20 per hour | reviews |
| `qa-thread`, `qa-reply` | 20, 60 per hour | Q&A |
| `report-create` | 30 per hour | reports |
| `certificate-verify` (IP) | 120 per minute | public verify |
| `checkout-quote` | 60 per minute | quote |
| `checkout-start` | 20 per 10 min | start |
| `checkout-confirm` | 30 per 10 min | Razorpay confirm |
| `checkout-order` | 120 per minute | order status (the return page polls) |
| `billing-cancel`, `billing-resume` | 10 per hour each | subscription |
| `course-create` | 30 per hour | new course |
| `authoring-ai` | 30 per hour, shared by drafts and polish | AI in the editor |
| `ai-grade` | 30 per hour | AI grading suggestion |
| `evs-videos` | 120 per 10 min | EVS picker |
| `admin-refund` | 30 per 10 min | refunds |
| `admin-export` | 10 per 10 min | orders CSV |
| `admin-erase` | 20 per hour | erase |
| `admin-evs-test` | 10 per minute | EVS connection test |

The web player sends a heartbeat every 15 s while playing (`BEAT_INTERVAL_MS` in
[`apps/web/src/lib/classroom/beat-accumulator.ts`](../../apps/web/src/lib/classroom/beat-accumulator.ts)),
plus one on pause, end, tab hide and unmount, which is exactly the 240 per hour budget for
uninterrupted play; see [troubleshooting.md](../guides/troubleshooting.md#heartbeats-answer-429).

## 10. Errors

Every non-2xx body is `{ error, code, details?, requestId }`
([`core/errors.ts`](../../apps/api/src/core/errors.ts), [`app.ts`](../../apps/api/src/app.ts)).
`code` is stable and the web app switches on it ([`apps/web/src/lib/errors.ts`](../../apps/web/src/lib/errors.ts)).

| Status | Common codes |
| --- | --- |
| 400 | `VALIDATION_FAILED` (with `details.fields`), `BAD_REQUEST`, `INVALID_CURSOR`, `CURRENCY_NOT_SUPPORTED`, `INTERVAL_REQUIRED`, `PAYMENT_NOT_VERIFIED`, `WRONG_GATEWAY`, `KIND_NOT_ACCEPTED`, `URL_INVALID`, `TOO_MANY_FILES`, `SUBMISSION_EMPTY`, `MEDIA_INVALID`, `QUESTION_INVALID`, `INVALID_VIDEO_REF`, `INVALID_RUBRIC`, `BAD_SIGNATURE`, `BAD_PAYLOAD`, `WEAK_PASSWORD` |
| 401 | `UNAUTHENTICATED`, `TOKEN_INVALID`, `SESSION_EXPIRED` |
| 403 | `FORBIDDEN`, `FORBIDDEN_AREA`, `COURSE_ACCESS_REQUIRED` (with `details.reason`), `SIGN_IN_REQUIRED`, `COURSE_ROLE_REQUIRED`, `NOT_FREE`, `ACCOUNT_RESTRICTED`, `ACCOUNT_BANNED`, `ACCOUNT_DEACTIVATED`, `REFUND_FORBIDDEN`, `REVIEW_NOT_ALLOWED`, `CORS_ORIGIN_DENIED`, `REGISTRATION_CLOSED` |
| 404 | `NOT_FOUND` and resource-specific variants; also used for things the caller may not know exist |
| 409 | `ALREADY_OWNED`, `SUBSCRIPTION_EXISTS`, `COUPON_INVALID` (`details.reason`), `CHECKOUT_IN_PROGRESS`, `CHECKOUT_CLOSED`, `CHECKOUT_EXPIRED`, `NOT_FOR_SALE`, `PRICE_NOT_AVAILABLE`, `CURRENCY_NOT_PAYABLE`, `ORDER_NOT_PENDING`, `REFUND_EXCEEDS`, `NOT_REFUNDABLE`, `SUBSCRIPTION_NOT_ACTIVE`, `NOTHING_TO_RESUME`, `RESUME_NOT_SUPPORTED`, `NO_ATTEMPTS_LEFT`, `ATTEMPT_CLOSED`, `ATTEMPT_OVERDUE`, `QUIZ_EMPTY`, `STAFF_PREVIEW`, `PREVIEW`, `SUBMISSION_PENDING`, `ALREADY_APPROVED`, `PAST_DUE`, `ALREADY_REVIEWED`, `NOT_A_VIDEO`, `VIDEO_NOT_READY`, `ITEM_COMPLETES_ITSELF`, `INVOICE_RENDERING`, `CERTIFICATE_RENDERING`, `CERTIFICATE_REVOKED`, `SLUG_TAKEN`, `COURSE_IN_USE`, `INVALID_STATUS`, `LAST_ADMIN` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `PUBLISH_BLOCKED` (`details.checklist`), `BELOW_PASS_MARK` |
| 429 | `RATE_LIMITED` (`details.retryAfterSeconds`, `Retry-After`) |
| 500 | `INTERNAL` (no detail, only `requestId`) |
| 502 | `GATEWAY_ERROR`, `VIDEO_SERVICE_UNAVAILABLE`, `VIDEO_SERVICE_ERROR`, `AI_FAILED` |
| 503 | `VIDEO_NOT_CONFIGURED`, `VIDEO_LIBRARY_NOT_CONFIGURED`, `EVS_WEBHOOK_NOT_CONFIGURED`, `AI_UNAVAILABLE` |

## 11. Integrations

| Integration | Modes | Notes |
| --- | --- | --- |
| Storage ([`integrations/storage.ts`](../../apps/api/src/integrations/storage.ts)) | `s3`, `local` | S3: presigning uses `S3_PUBLIC_ENDPOINT` when set (the emulator) while the API talks to `AWS_ENDPOINT_URL`. Local: files under `DATA_DIR/media`, HMAC-signed URLs served by `/api/media/local/:token` |
| Mail ([`integrations/mail/mailer.ts`](../../apps/api/src/integrations/mail/mailer.ts)) | `outbox`, `smtp`, `ses` | Outbox writes `.eml` files under `DATA_DIR/outbox` and keeps the last 200 in memory for tests |
| Redis ([`integrations/redis.ts`](../../apps/api/src/integrations/redis.ts)) | | BullMQ connections and rate limits |
| Payments ([`services/payments/gateway.ts`](../../apps/api/src/services/payments/gateway.ts)) | Stripe, Razorpay | Plain `fetch` REST clients, no SDKs, timeouts, `redirect: "error"` |
| EVS ([`integrations/evs.ts`](../../apps/api/src/integrations/evs.ts)) | | 10 s timeout, `redirect: "error"` |
| AI ([`integrations/ai/index.ts`](../../apps/api/src/integrations/ai/index.ts)) | `openai`, `gemini`, `stub`, `none` | |
