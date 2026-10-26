# Threat model

A STRIDE analysis of Euron Open LMS as deployed by the Terraform in `infra/terraform` (an
aws-prod shaped environment with CloudFront and WAF) and the defaults in the code. Each row
names the threat, the control that exists today and what remains. Controls are described in
[security.md](security.md). **Accepted** means a design choice; **open** means a known gap
that should be fixed; the rating (low, medium, high) is the impact on a typical academy if
exploited. Paths are relative to the repository root.

## Defects of the replaced system, and what fixes them

This LMS replaces an earlier one whose defects shaped the design. Each is closed by a
specific control:

| Defect | Fix in this design | Where |
| --- | --- | --- |
| A paid course could be enrolled in through the free-enroll endpoint | Free enroll checks `access_mode = 'FREE'` on a published course (`403 NOT_FREE`); paid access is only ever granted by fulfilment after an amount-checked payment | [`services/catalog.service.ts`](../../apps/api/src/services/catalog.service.ts), [`domain/entitlements.ts`](../../apps/api/src/domain/entitlements.ts) |
| Access checks that were always truthy (any enrollment row, or a flag from the client) | One pure `decideAccess` over source, status, `valid_until`, refund state and the subscription, reached through one service; the client renders the server's decision | [`services/access.service.ts`](../../apps/api/src/services/access.service.ts), [ADR 0012](adr/0012-entitlements-as-one-pure-function.md) |
| Course content and quiz answer keys served without authentication | Every content route authenticates (previews excepted, lectures only) and checks access; answer keys leave the API only through the reveal policy | [`presenters/attempt.presenter.ts`](../../apps/api/src/presenters/attempt.presenter.ts) |
| Webhooks processed twice, and paid amounts taken from the event | Signature first, `payment_events (gateway, event_id)` unique, then `amountMatches` against the order | [`services/payments/webhook.service.ts`](../../apps/api/src/services/payments/webhook.service.ts), [`domain/orders.ts`](../../apps/api/src/domain/orders.ts) |
| Money as floats | Integer minor units with a currency, a database CHECK on totals, half-up rounding per line | [`domain/pricing.ts`](../../apps/api/src/domain/pricing.ts), [ADR 0013](adr/0013-money-in-minor-units-with-a-server-price-book.md) |
| Client-chosen currency and amount | The client picks one of the academy's enabled currencies; the amount is that currency's price-book row; the server routes the gateway | [`services/checkout.service.ts`](../../apps/api/src/services/checkout.service.ts) |
| Mass assignment (request bodies spread into updates) | Strict zod schemas and explicit field lists; status moves are separate conditional updates | [`core/validate.ts`](../../apps/api/src/core/validate.ts), [`services/admin-course.service.ts`](../../apps/api/src/services/admin-course.service.ts) |
| XSS through markdown rendered with raw HTML and no sanitiser | markdown-it with `html: false`, `safeUrl` on every link, images only in staff content, rendered on the server | [`domain/markdown.ts`](../../apps/api/src/domain/markdown.ts) |
| Tokens in `localStorage` | Access token in memory only; refresh token in an httpOnly, path-scoped cookie with rotation and reuse detection | [`apps/web/src/lib/session.ts`](../../apps/web/src/lib/session.ts), [ADR 0005](adr/0005-refresh-rotation-cookie-and-memory-token.md) |
| Attaching any file URL or storage key a client sent | Media by upload id only, owner and purpose checked | [`services/media-attach.service.ts`](../../apps/api/src/services/media-attach.service.ts) |

## Scope and trust boundaries

| Boundary | Crossing |
| --- | --- |
| TB1 | Internet to the edge (CloudFront, WAF, ALB): every request is untrusted |
| TB2 | Edge to tasks: TLS ends at the ALB, tasks in private subnets, the CDN's secret origin header required |
| TB3 | Application to its stores (RDS, ElastiCache, S3, Secrets Manager, KMS): IAM task roles, security groups, TLS |
| TB4 | Application to third parties: Stripe and Razorpay (checkout, refunds, webhooks in), EVS (playback mint, video list, webhooks in), SES, the AI provider |
| TB5 | Browser straight to S3 (presigned URLs), to Stripe's hosted page or Razorpay's modal, and to EVS manifests and segments: paths that skip the API |

Inside the application a logical boundary separates the principals:

| Principal | Holds |
| --- | --- |
| Visitor | The public catalog, course pages, free previews, certificate verification |
| Learner | Their enrollments, progress, attempts, submissions, notes, orders, invoices, subscription |
| Instructor | Authoring and grading on the courses whose `course_staff` they are on |
| Operator (`SUPPORT`, `FINANCE`, `ADMIN`) | The `/admin` areas their role opens |
| Gateways and EVS | Their webhooks, authenticated by signature only |

## Assets

| Rank | Asset | Why it matters |
| --- | --- | --- |
| 1 | Paid course content and video | The academy's product; leakage is lost revenue |
| 2 | Money flows: orders, refunds, subscriptions, the gateway secrets | Fraud and chargebacks |
| 3 | Credentials and sessions, the JWT and TOTP keys | Account takeover, including of operators |
| 4 | Assessment integrity: answer keys, grades, certificates | A certificate is worth what its checks are |
| 5 | Learner data: identity, progress, submissions, billing details | Privacy |
| 6 | Operator powers and the audit trail | Abuse or loss of accountability |
| 7 | Availability of the API, worker and the reconcile and expiry jobs | Paid learners locked out, lost payments |

## STRIDE by surface

### 1. Course access

| STRIDE | Threat | Control | Residual |
| --- | --- | --- | --- |
| E | Enroll in a paid course for free | `canSelfEnrollFree`; checkout prices on the server; fulfilment only after an amount match | Low |
| E | Keep access after a refund, revoke or expiry | Access is computed per request from the enrollment, its order and the subscription; `REVOKED`, `REFUNDED`, `EXPIRED`, `SUBSCRIPTION_ENDED` | Low |
| E | Open a draft or archived course | `NOT_PUBLISHED` is a 404 to learners; only staff and ADMIN/SUPPORT pass | Low |
| E | Use a preview to reach non-preview content | Previews are per item, lectures only, on published courses; progress, notes and attempts refuse previews | Low |
| E | An instructor reads another instructor's course | `requireCourseStaff`: 404 unless on its staff | Low |
| I | Read lecture video refs or PDF keys from the API | Not in learner DTOs; signed URLs and playback sessions only after the check | Low |
| E | A suspended learner keeps learning | Accepted: suspension blocks writes, not paid content | Accepted |

### 2. Quizzes

| STRIDE | Threat | Control | Residual |
| --- | --- | --- | --- |
| I | Read the answer key from an attempt | The presenter builds questions field by field without `correct`; results include the key only per `mayReveal` | Low |
| I | Infer answers from per-question right or wrong | With the key withheld, the breakdown is withheld too | Low |
| T | Submit answers to option ids or questions not in the attempt | `cleanAnswers` and `grade` read only the snapshot | Low |
| T | Beat the timer by editing the client | The deadline is enforced on the server; past a 5 s grace only autosaved answers count | Low |
| T | Retry until the bank is learned | `max_attempts`, RANDOM draws, shuffles from the CSPRNG, `AFTER_PASS` or `NEVER` reveal | Medium, accepted: unlimited attempts are the default |
| T | Double submit to get two grades | Conditional close under a row lock | Low |
| T | Regrade history by editing the bank | Snapshots freeze questions and keys per attempt | Low |
| D | A catastrophic REGEX accepted answer | Patterns at most 200 characters, answers at most 500; authored by staff only | Low, open |

### 3. Assignments and grading

| STRIDE | Threat | Control | Residual |
| --- | --- | --- | --- |
| E | A learner grades themselves or a peer | Grading needs a course staff role or ADMIN; learners have no grading route | Low |
| E | An instructor grades another course | Submissions of other courses are 404 | Low |
| T | Prompt injection in a submission to get full marks | The submission is fenced as data; the AI draft is never applied; the grader decides; the audit records how far the decision moved from the draft | Low |
| T | Resubmit while a version is under review | One version waits at a time (`SUBMISSION_PENDING`), versions unique per learner and item | Low |
| T | Approve below the pass mark | `422 BELOW_PASS_MARK` | Low |
| S | A malicious file sent to a grader | Type allowlist and magic bytes, served as signed attachments; no malware scanning | Medium, open |

### 4. Payments

| STRIDE | Threat | Control | Residual |
| --- | --- | --- | --- |
| S | Forge a webhook | HMAC over the raw body, constant time, 300 s window (Stripe); 400 without a valid signature | Low: a secret equal to the placeholder `set-me` counts as unset and the webhook is refused |
| R, T | Replay a captured webhook | Timestamp window, and `payment_events (gateway, event_id)` makes a replay a no-op | Low |
| T | Pay less than the price | The amount is taken from the price book; the captured amount must equal the order total; mismatches are flagged and audited | Low |
| T | Send an amount or a currency from the client | The API takes neither an amount nor an unenabled currency | Low |
| T | Rounding errors | Integer minor units, largest-remainder allocation, half-up per line, a CHECK on totals | Low |
| T | Forge the Razorpay success payload | HMAC with the key secret, then the payment is fetched and checked against the order | Low |
| T | Fulfil twice (webhook and return page racing) | One fulfilment path, order row lock, conditional update to PAID | Low |
| T | Reuse a coupon beyond its limits | `per_user_limit` from paid orders, `max_redemptions` checked at quote and counted under the cap at fulfilment | Low: a race can overrun a cap by the orders in flight; audited and honoured |
| E | A support agent refunds money | `canRefund`: ADMIN and FINANCE only | Low |
| T | Refund more than was paid | Lock, pending refunds counted, database condition at settlement | Low |
| R | Deny a refund or price change | `refund.request`, `refund.settle`, settings and price changes audited in the same transaction | Low |
| I | Card or UPI details in our database | Never handled; stored webhook payloads are redacted | Low |
| T | Point the API at a fake gateway | Base URLs are configuration; a stub base URL is only a warning in production | Low, open |

### 5. Subscriptions

| STRIDE | Threat | Control | Residual |
| --- | --- | --- | --- |
| E | Activate a plan without paying | Only fulfilment (after an amount match) moves INCOMPLETE to live; status events on INCOMPLETE are ignored | Low |
| E | Revive a cancelled subscription with a late event | Terminal rows are never revived by status events | Low |
| T | Two live subscriptions | Partial unique index on live statuses | Low |
| T | A renewal for a different amount | Must equal the subscription's amount and currency | Low |
| E | Keep access after a failed renewal | Grace of `subscriptionGraceDays`, then `billing.expire-subscriptions` | Accepted: grace is the point |

### 6. Video

| STRIDE | Threat | Control | Residual |
| --- | --- | --- | --- |
| I | Steal the EVS key | Server-side only; never in a DTO or log | Low |
| I | Share a manifest URL | EVS tokens are short-lived and bound to the viewer and video; watermark per EVS policy | Medium, accepted: a screen recording cannot be prevented |
| I | Share HLS or MP4 URLs | Handed out only after the check, but the URL is whatever the host serves | Medium, accepted: use EVS for protected content |
| S | Forge `video.ready` to publish an unfinished video | Signed EVS webhook; the handler only sets status and duration | Low: `set-me` counts as unset, as above |

### 7. Content injection

| STRIDE | Threat | Control | Residual |
| --- | --- | --- | --- |
| T | Stored XSS in descriptions, articles, Q&A, reviews, submissions | `html: false`, `safeUrl`, community content without images, a nonce-based CSP with `strict-dynamic` | Low |
| T | `javascript:` or `data:` links | `safeUrl` (http and https only) | Low |
| T | SVG or HTML uploads executing from a signed URL | Refused by type and extension | Low |
| T | Mass assignment of `status`, `role`, `featured`, prices | Strict schemas, explicit fields, role checks per field | Low |

### 8. Account takeover

| STRIDE | Threat | Control | Residual |
| --- | --- | --- | --- |
| S | Credential stuffing | Two failure budgets with a uniform 429; bcrypt 12; optional TOTP | Medium, accepted: TOTP is optional |
| S | Steal a token with injected script | Access token in memory, refresh token httpOnly; CSP | Low |
| S | Steal and reuse a refresh token | Rotation with reuse detection revokes the family | Low |
| I | Enumerate accounts | Uniform answers for login, forgot password and resend; timing equalised | Low |
| E | Keep a session after a ban | User reloaded per request; ban bumps `token_version` and revokes sessions | Low |
| S | Take over an account through `admin:create` | Existing accounts are promoted without touching the password | Low |

### 9. Certificates

| STRIDE | Threat | Control | Residual |
| --- | --- | --- | --- |
| S | Forge a certificate | Verification is by serial against the database; the serial is random (10 symbols) | Low |
| T | Earn one without completing | Issued only by the rollup when every item is complete; items complete only by their own rules | Low |
| R | Hide a revocation | The public verify page shows revoked certificates; revoke and restore are audited | Low |
| I | Enumerate certificates | Random serials, 120 verifications per minute per IP | Low |

### 10. Operators

| STRIDE | Threat | Control | Residual |
| --- | --- | --- | --- |
| E | A role reaching areas it should not | `requireArea` in every admin service; the matrix is unit-tested | Low |
| E | Lock out every admin | Last-admin checks with row locks; admins are not actionable from the learner console | Low |
| R | Deny an action | `audit_log` written in the same transaction for grants, revokes, suspensions, bans, erasures, refunds, role and settings changes, grading decisions, certificate revocations | Low; the audit log has no tamper evidence beyond database access control |
| I | Operators read learner data | Expected for SUPPORT and ADMIN; minimal data in DTOs | Accepted |

### 11. Availability

| STRIDE | Threat | Control | Residual |
| --- | --- | --- | --- |
| D | Request floods | WAF rate limit, per-route budgets in Redis | Medium |
| D | Large bodies | 1 MB JSON and webhook bodies; media never through the API | Low |
| D | Lost webhooks or a down worker | Return-page sync, Razorpay confirm, reconcile and expiry jobs | Low |
| D | Redis loss | Rate limits fall back per task; queued jobs lost (receipts, PDF renders) | Medium, accepted |

## Summary of open items

| Item | Rating | Fix |
| --- | --- | --- |
| No malware scanning of submission files and resources | Medium | Scan on `complete`, or document that graders open files in a sandbox |
| REGEX accepted answers without a time limit | Low | Run with a timeout or a safe-regex check at authoring time |
| Stub gateway base URLs allowed in production | Low | Accepted: warned at every boot and shown as "stub" in Settings, Integrations |
