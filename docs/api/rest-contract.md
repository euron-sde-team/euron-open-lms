# REST contract

Every route the API serves, the DTO it returns (`packages/types`), and the router file that
owns it (`apps/api/src/routes`). The generated OpenAPI document
([`openapi.yaml`](openapi.yaml), `pnpm openapi`) is built from the route files' doc
comments; this page is the human map. Inbound webhooks are described in
[webhooks.md](webhooks.md).

Conventions:

- Base path `/api`. JSON in and out. Every non-2xx body is `ApiError`
  (`{ error, code, details?, requestId }`); switch on `code`.
- Creates answer **201** with the created resource (or, for categories, the whole list).
  Deletes and fire-and-forget actions answer **204** with no body.
- Lists are keyset pages: `Page<T>` (`{ items, nextCursor }`) with `?cursor=&limit=`
  (default 20, max 50). A few small bounded lists are plain arrays; they are marked `T[]`.
- Money is `{ amountMinor, currency }`. A client never sends an amount: checkout prices on
  the server.
- Ids in paths are ULIDs; slugs are `[a-z0-9-]`. Every body schema is `.strict()`: unknown
  keys are `400 VALIDATION_FAILED`.
- Auth: `Authorization: Bearer <access token>`; the refresh token is the httpOnly
  `lms_refresh` cookie on `/api/auth`.
- `auth` = signed in, `optional` = public with extras when signed in, `public` = no auth.
- Content routes go through `services/access.service.ts`: unknown or unpublished courses are
  404 to learners; a published course without access is `403 COURSE_ACCESS_REQUIRED` with
  `details.reason` (`NOT_ENROLLED`, `EXPIRED`, `REVOKED`, `REFUNDED`, `SUBSCRIPTION_ENDED`,
  `INACTIVE_ACCOUNT`); signed out is `403 SIGN_IN_REQUIRED`.
- Admin routes go through `requireArea(actor, area)` (`403 FORBIDDEN_AREA`); course-level
  routes also through `requireCourseStaff`. An instructor asking for a course they are not on
  gets 404.

## Core: `auth.routes.ts`, `users.routes.ts`, `meta.routes.ts`, `media.routes.ts`, `notifications.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| POST | /auth/signup | public | **201** `AuthResult` and the refresh cookie, or **202** `{ verificationRequired: true, email }` when email verification is on |
| POST | /auth/verify-email `{ token }` | public | `AuthResult` |
| POST | /auth/resend-verification, /auth/forgot-password | public | **202** `{ ok: true }` (same answer whether or not the account exists) |
| POST | /auth/login `{ login, password, totp? \| recoveryCode? }` | public | `AuthResult`, or `{ totpRequired: true }`; 429 once a failure budget is spent |
| POST | /auth/refresh | cookie | `AuthResult` with a rotated cookie; **204** without a cookie; 401 `SESSION_EXPIRED` |
| POST | /auth/logout | cookie | 204 |
| POST | /auth/logout-all | auth | 204 |
| POST | /auth/reset-password, /auth/change-password | public / auth | 204 (sessions revoked, `token_version` bumped) |
| GET | /auth/me | auth | `Me` |
| POST | /auth/totp/setup, /auth/totp/enable, /auth/totp/disable, /auth/totp/recovery-codes | auth | setup: secret and `otpauth://` URL; enable and recovery-codes: `{ recoveryCodes }`; disable: 204 |
| GET, PATCH | /users/me | auth | `Me` |
| DELETE | /users/me `{ password, totp? \| recoveryCode? }` | auth | `{ purgeAfter }`; 409 `SUBSCRIPTION_ACTIVE`, `LAST_ADMIN` |
| GET | /users/me/export | auth | JSON download (3 per day) |
| GET | /users/me/sessions | auth | `SessionInfo[]` |
| DELETE | /users/me/sessions/:id | auth | 204 |
| GET | /meta | public | `AcademyMeta` (academy name, tagline, logo, registration, currencies, payment gateways and routing, whether plans exist, AI flags, support email); cached 30 s |
| GET | /meta/sitemap?type=courses\|bundles\|instructors&cursor= | public | `{ items: { path, updatedAt }[], nextCursor }`, 1000 per page |
| POST | /media/uploads `{ purpose, fileName, mimeType, sizeBytes }` | auth | **201** `{ uploadId, put }` |
| POST | /media/uploads/:id/complete | auth | `Media` |
| DELETE | /media/uploads/:id | auth | 204 (only an upload nothing uses) |
| PUT, GET | /media/local/:token | signed token | `STORAGE=local` only: the stand-in for presigned PUT and GET |
| GET | /media/:id | optional | `Media` (access-checked by what it is attached to) |
| GET | /notifications?unread=true&cursor= | auth | `Page<Notification>` |
| GET | /notifications/counts | auth | `NotificationCounts` |
| POST | /notifications/:id/read, /notifications/read-all | auth | 204 |

## Catalog: `catalog.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | /catalog/courses?q=&category=&level=&language=&price=free\|paid\|subscription&sort=relevance\|popular\|newest\|rating\|price_asc\|price_desc&currency=&cursor=&limit= | optional | `Page<CourseCard>` |
| GET | /catalog/facets (same filters) | public | `CatalogFacets` |
| GET | /catalog/featured?currency= | optional | `{ featured, popular, newest, free }`, each `CourseCard[]` |
| GET | /catalog/categories | public | `Category[]` |
| GET | /catalog/courses/:slug?currency= | optional | `CourseDetail` with `access` (DRAFT/ARCHIVED: 404 except to staff) |
| GET | /catalog/courses/:slug/reviews?rating=&cursor= | optional | `Page<Review>` |
| GET | /catalog/bundles?currency=&cursor= | optional | `Page<BundleCard>` |
| GET | /catalog/bundles/:slug?currency= | optional | `BundleDetail` |
| GET | /catalog/instructors/:username | optional | `{ instructor: Instructor, courses: CourseCard[] }` |
| POST | /catalog/courses/:slug/enroll | auth | **201** `{ enrollmentId, resumeItemId }` (the same enrollment when called again); FREE courses only, else 403 `NOT_FREE` |
| PUT, DELETE | /catalog/courses/:slug/save | auth | 204 (wishlist) |

`currency` picks the display price (else the viewer's `preferredCurrency`, else the academy
default).

## Classroom: `learn.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | /learn/:courseSlug | auth | `Classroom` (creates the SUBSCRIPTION enrollment on first open under a plan) |
| GET | /learn/items/:itemId | optional | `ItemContent` (preview lectures open without access) |
| POST | /learn/items/:itemId/playback | optional | `Playback` (an EVS session minted after the check, an HLS/MP4 URL or a YouTube embed) |
| POST | /learn/items/:itemId/progress `ProgressBeat` | auth | `ProgressResult` (videos; 409 `PREVIEW`, `STAFF_PREVIEW`, `NOT_A_VIDEO`) |
| POST | /learn/items/:itemId/complete | auth | `ProgressResult` (articles and PDFs; 409 `ITEM_COMPLETES_ITSELF`) |
| PUT, DELETE | /learn/items/:itemId/bookmark | auth | 204 |
| GET | /learn/:courseSlug/notes?itemId=&cursor= | auth | `Page<Note>` |
| POST | /learn/items/:itemId/notes `{ body, atSeconds? }` | auth | **201** `Note` |
| PATCH | /learn/notes/:noteId | auth | `Note` (own notes only; others are 404) |
| DELETE | /learn/notes/:noteId | auth | 204 |

## My learning: `my.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | /my/learning?status=in_progress\|completed\|all&cursor= | auth | `Page<LearningEntry>` (lapsed access listed with `active: false`) |
| GET | /my/summary | auth | `LearningSummary` |
| GET | /my/saved?cursor= | auth | `Page<CourseCard>` |
| GET | /my/bookmarks?cursor= | auth | `Page<{ item: { id, title, kind }, course: { slug, title }, createdAt }>` |
| GET | /my/certificates | auth | `Certificate[]` |

## Certificates: `certificates.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | /certificates/:serial | optional | `Certificate` (`pdfUrl` only for the owner; revoked ones say so); 120 per minute per IP |
| GET | /certificates/:serial/pdf | auth (owner) | 302 to a signed URL; 409 `CERTIFICATE_RENDERING`, `CERTIFICATE_REVOKED` |

## Assessments: `assessments.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| POST | /assessments/quizzes/:itemId/attempts | auth | `QuizAttempt` (200; resumes the open attempt); 409 `NO_ATTEMPTS_LEFT`, `STAFF_PREVIEW`, `QUIZ_EMPTY` |
| GET | /assessments/attempts/:attemptId | auth | `QuizAttempt` (own only) |
| PUT | /assessments/attempts/:attemptId/answers `{ answers: Record<questionId, AnswerValue> }` | auth | 204; 409 `ATTEMPT_CLOSED`, `ATTEMPT_OVERDUE` |
| POST | /assessments/attempts/:attemptId/submit `{ answers? }` | auth | `{ attempt: QuizAttempt, progress: ProgressResult \| null }` (progress when the attempt passed) |
| POST | /assessments/assignments/:itemId/submissions `{ body?, url?, uploadIds? }` | auth | **201** `Submission`; 409 `SUBMISSION_PENDING`, `ALREADY_APPROVED`, `PAST_DUE`, `STAFF_PREVIEW` |
| GET | /assessments/assignments/:itemId/submissions | auth | `Submission[]` (own, newest version first) |

## Community: `community.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | /community/courses/:courseId/review-eligibility | auth | `ReviewEligibility` |
| PUT | /community/courses/:courseId/review `{ rating, body? }` | auth | `Review` (create or edit own); 403 `REVIEW_NOT_ALLOWED` |
| DELETE | /community/courses/:courseId/review | auth | 204 |
| POST | /community/reviews/:reviewId/reply `{ body }` | auth (course OWNER/EDITOR or admin) | `Review` |
| GET | /community/courses/:courseId/questions?itemId=&q=&sort=recent\|unanswered&cursor= | auth (access) | `Page<QaThread>` |
| POST | /community/courses/:courseId/questions `{ title, body, itemId? }` | auth (access) | **201** `QaThread` |
| GET | /community/questions/:threadId | auth (access) | `QaThreadDetail` |
| POST | /community/questions/:threadId/replies `{ body }` | auth (access) | **201** `QaReply` |
| POST | /community/questions/:threadId/accept `{ replyId \| null }` | auth (asker or staff) | `QaThreadDetail` |
| PATCH | /community/questions/:threadId, /community/replies/:replyId | auth (author) | `QaThread` / `QaReply` |
| DELETE | /community/questions/:threadId, /community/replies/:replyId | auth (author) | 204 |
| POST | /community/reports `{ targetType, targetId, reason, note? }` | auth | **201** `{ id }` (one per reporter per target) |

## Checkout: `checkout.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | /checkout/plans?currency= | optional | `Plan[]` |
| POST | /checkout/quote `CheckoutQuoteRequest` | auth | `CheckoutQuote` (an inapplicable coupon comes back as `couponError`) |
| POST | /checkout/start `CheckoutStartRequest` | auth | **201** `CheckoutHandoff` (`REDIRECT`, `RAZORPAY_MODAL` or `FULFILLED`); the same order for a repeated `idempotencyKey` |
| POST | /checkout/razorpay/confirm `RazorpayConfirm` | auth | `Order` (signature verified, payment fetched, fulfilled when captured); 400 `PAYMENT_NOT_VERIFIED` |
| GET | /checkout/orders/:id?sync=1 | auth (own) | `Order`; `sync` asks Stripe once about a PENDING order |
| POST | /checkout/orders/:id/cancel | auth (own, PENDING) | `Order`; 409 `ORDER_NOT_PENDING` |

## Billing: `billing.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | /billing/orders?cursor= | auth | `Page<Order>` |
| GET | /billing/invoices?cursor= | auth | `Page<Invoice>` (invoices and credit notes) |
| GET | /billing/invoices/:id/pdf | auth (own) | 302 to a signed URL; 409 `INVOICE_RENDERING` |
| GET | /billing/subscription | auth | `SubscriptionSummary \| null` |
| POST | /billing/subscription/cancel | auth | `SubscriptionSummary` (at period end) |
| POST | /billing/subscription/resume | auth | `SubscriptionSummary`; 409 `NOTHING_TO_RESUME`, `RESUME_NOT_SUPPORTED` (Razorpay) |

## Webhooks: `webhooks.routes.ts`, `evs-webhook.routes.ts`

Raw body, no auth, signature verified first. Details: [webhooks.md](webhooks.md).

| Method | Path | Signature |
| --- | --- | --- |
| POST | /webhooks/stripe | `Stripe-Signature: t=..,v1=..`, HMAC-SHA256 over `"<t>.<raw body>"`, 300 s |
| POST | /webhooks/razorpay | `X-Razorpay-Signature` hex HMAC-SHA256 over the raw body; dedupe on `X-Razorpay-Event-Id` |
| POST | /webhooks/evs | `EVS-Signature: t=..,v1=..`; `video.ready` / `video.failed` set `lectures.video_status` |

## Admin: courses `admin-courses.routes.ts`

Area `courses`. Instructors see only the courses they are on (OWNER manages, EDITOR edits
content, GRADER reads); a visible course without the right is 403 `COURSE_ROLE_REQUIRED`.

| Method | Path | Returns |
| --- | --- | --- |
| GET | /admin/courses?q=&status=&cursor=&limit= | `Page<AdminCourseRow>` |
| POST | /admin/courses `{ title, slug? }` | **201** `AdminCourse` (the creator becomes OWNER; INSTRUCTOR or ADMIN only) |
| GET, PATCH | /admin/courses/:id | `AdminCourse` (PATCH: explicit fields only, never status) |
| DELETE | /admin/courses/:id | 204 (unused drafts only; 409 `COURSE_IN_USE`) |
| POST | /admin/courses/:id/publish, /unpublish, /archive | `AdminCourse` (publish: 422 `PUBLISH_BLOCKED` with `details.checklist`) |
| PUT | /admin/courses/:id/prices `{ prices: { currency, amountMinor, compareAtMinor? }[] }` | `AdminPrice[]` |
| PUT | /admin/courses/:id/staff `{ staff: { userId, role, listed }[] }` | `AdminCourse` (at least one OWNER) |
| GET | /admin/courses/:id/learners?cursor= | `Page<{ user, progressPercent, completedAt, source, createdAt }>` |
| POST | /admin/courses/:id/sections `{ title }` | **201** `AdminSection` |
| PATCH | /admin/courses/:id/sections/:sectionId | `AdminSection` |
| DELETE | /admin/courses/:id/sections/:sectionId | 204 |
| POST | /admin/courses/:id/sections/:sectionId/move `{ toIndex }` | `AdminSection[]` |
| POST | /admin/courses/:id/items `{ sectionId, kind, title, lectureKind? }` | **201** `AdminItem` |
| GET, PATCH | /admin/courses/:id/items/:itemId | `AdminItem` (PATCH by kind: `lecture`, `quiz` or `assignment` block) |
| DELETE | /admin/courses/:id/items/:itemId | 204 |
| POST | /admin/courses/:id/items/:itemId/move `{ sectionId, toIndex }` | `AdminSection[]` |
| POST | /admin/courses/:id/items/:itemId/resources `{ title, uploadId? \| url? }` | **201** `AdminItem` |
| DELETE | /admin/courses/:id/items/:itemId/resources/:resourceId | `AdminItem` |
| PUT | /admin/courses/:id/items/:itemId/questions `{ questionIds }` | `AdminItem` (FIXED quizzes) |
| GET | /admin/courses/:id/questions?q=&tag=&cursor= | `Page<AdminQuestion>` |
| POST | /admin/courses/:id/questions | **201** `AdminQuestion` |
| PATCH | /admin/courses/:id/questions/:questionId | `AdminQuestion` |
| DELETE | /admin/courses/:id/questions/:questionId | 204, or 200 with the archived `AdminQuestion` when a quiz uses it |
| POST | /admin/courses/:id/ai/questions `{ itemId?, sourceText?, count, kinds }` | `{ drafts }` (never saved) |
| POST | /admin/courses/:id/ai/polish `{ field, text }` | `{ text }` |

## Admin: catalog `admin-catalog.routes.ts`, EVS `admin-evs.routes.ts`

| Method | Path | Area | Returns |
| --- | --- | --- | --- |
| GET | /admin/catalog/categories | courses | `Category[]` |
| POST | /admin/catalog/categories `{ name, slug?, description? }` | ADMIN | **201** `Category[]` (the whole list) |
| POST | /admin/catalog/categories/reorder `{ ids }` | ADMIN | `Category[]` |
| PATCH | /admin/catalog/categories/:id | ADMIN | `Category` |
| DELETE | /admin/catalog/categories/:id | ADMIN | the deleted `Category` (200) |
| GET | /admin/evs/videos?q=&page= | courses | `{ items: EvsVideo[], page, total }` (503 `VIDEO_LIBRARY_NOT_CONFIGURED` without a read key) |
| GET | /admin/evs/status | courses | `{ configured, canListVideos }` |

## Admin: grading `admin-grading.routes.ts`, moderation `admin-moderation.routes.ts`

| Method | Path | Area | Returns |
| --- | --- | --- | --- |
| GET | /admin/grading?status=SUBMITTED&courseId=&cursor= | grading | `Page<GradingRow>` (oldest first) |
| GET | /admin/grading/:submissionId | grading | `GradingDetail` |
| POST | /admin/grading/:submissionId/review `{ decision, scores, feedback? }` | grading | `GradingDetail`; 409 `ALREADY_REVIEWED`, 422 `BELOW_PASS_MARK` |
| POST | /admin/grading/:submissionId/ai-suggestion | grading | `GradingDetail` (draft only); 503 `AI_UNAVAILABLE` |
| GET | /admin/moderation/reports?status=OPEN\|RESOLVED&cursor= | moderation | `Page<AdminReport>` |
| POST | /admin/moderation/reports/:id/resolve `{ action: HIDE\|RESTORE\|DISMISS, note? }` | moderation | `AdminReport` |

## Admin: commerce `admin-commerce.routes.ts`

| Method | Path | Area | Returns |
| --- | --- | --- | --- |
| GET | /admin/commerce/orders?q=&status=&gateway=&cursor= | orders | `Page<AdminOrderRow>` |
| GET | /admin/commerce/orders/:id | orders | `AdminOrderDetail` (event timeline, refunds, enrollments, invoices, refundable amount) |
| POST | /admin/commerce/orders/:id/refunds `{ amountMinor, reason, revokeAccess }` | orders (ADMIN, FINANCE) | `AdminOrderDetail`; 409 `REFUND_EXCEEDS`, `NOT_REFUNDABLE`; 502 `GATEWAY_ERROR` |
| GET | /admin/commerce/subscriptions?status=&cursor= | orders | `Page<AdminSubscriptionRow>` |
| POST | /admin/commerce/subscriptions/:id/cancel `{ atPeriodEnd }` | orders (ADMIN, FINANCE) | `AdminSubscriptionRow` |
| GET | /admin/commerce/plans | plans | `AdminPlan[]` |
| POST | /admin/commerce/plans | plans | **201** `AdminPlan` |
| PATCH | /admin/commerce/plans/:id | plans | `AdminPlan` |
| PUT | /admin/commerce/plans/:id/prices `{ prices: { currency, interval, amountMinor }[] }` | plans | `AdminPrice[]` |
| GET | /admin/commerce/bundles?q=&status=&cursor= | plans | `Page<AdminBundle>` |
| POST | /admin/commerce/bundles | plans | **201** `AdminBundle` |
| GET, PATCH | /admin/commerce/bundles/:id | plans | `AdminBundle` |
| PUT | /admin/commerce/bundles/:id/prices | plans | `AdminPrice[]` |
| GET | /admin/commerce/coupons?q=&cursor= | coupons | `Page<AdminCoupon>` |
| POST | /admin/commerce/coupons | coupons | **201** `AdminCoupon` |
| PATCH | /admin/commerce/coupons/:id | coupons | `AdminCoupon` |
| GET | /admin/commerce/export/orders.csv?from=&to= | orders | CSV, streamed |

## Admin: operations `admin.routes.ts`

| Method | Path | Area | Returns |
| --- | --- | --- | --- |
| GET | /admin/me | any operator | `AdminSession` |
| GET | /admin/stats?from=&to= | overview | `AdminStats` (instructors: their courses only) |
| GET | /admin/stats.csv?from=&to= | overview | CSV |
| GET | /admin/learners?q=&status=&cursor= | learners | `Page<AdminUserRow>` |
| GET | /admin/learners/:id | learners | `AdminLearnerDetail` |
| POST | /admin/learners/:id/enrollments `{ courseId, validUntil?, note? }` | learners | **201** `AdminEnrollment` |
| POST | /admin/enrollments/:id/revoke `{ reason }` | learners | `AdminEnrollment` |
| PATCH | /admin/enrollments/:id `{ validUntil }` | learners | `AdminEnrollment` |
| POST | /admin/learners/:id/suspend `{ days, reason }`, /unsuspend, /ban `{ reason }`, /unban | learners | `AdminUserRow` |
| POST | /admin/learners/:id/erase `{ reason }` | ADMIN | 204 |
| GET | /admin/certificates?q=&cursor= | certificates | `Page<AdminCertificateRow>` |
| POST | /admin/certificates/:id/revoke `{ reason }`, /restore | certificates | `AdminCertificateRow` |
| GET | /admin/staff?role=&q=&cursor= | staff | `Page<StaffRow>` |
| PATCH | /admin/staff/:userId `{ role }` | staff | `StaffRow`; 409 `LAST_ADMIN` |
| GET, PATCH | /admin/settings | settings | `LmsSettings` |
| GET | /admin/integrations | settings | `IntegrationStatus` (gateway modes, EVS, AI, mail, storage; never a key) |
| POST | /admin/integrations/evs/test | settings | `{ ok, message }` |
| GET | /admin/audit?action=&actorId=&entityType=&entityId=&cursor= | audit | `Page<AuditEntry>` |

## Health

| Method | Path | Returns |
| --- | --- | --- |
| GET | /up | `{ ok: true }` (liveness) |
| GET | /api/ready | `{ ok: true }`, or 503 when Postgres or Redis does not answer |
