# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.x (latest minor) | Yes |
| Older minors | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository ("Security" tab, "Report a vulnerability"):
https://github.com/euron-sde-team/euron-open-lms/security/advisories/new

Please include:

- the affected component (`apps/api`, `apps/web`, `infra/terraform/...`) and version or commit,
- a description of the issue and its impact,
- steps to reproduce, or a proof of concept,
- any suggested mitigation.

What to expect:

| Stage | Target |
| ----- | ------ |
| Acknowledgement | within 3 business days |
| Initial assessment and severity | within 7 business days |
| Fix or mitigation for critical / high issues | within 30 days |
| Coordinated public disclosure | after a fix is released, credited to you unless you prefer otherwise |

## Scope

In scope: the code in this repository and the infrastructure it provisions with its
default settings. We are most interested in:

- **Authentication and sessions.** Account takeover, token or refresh-cookie theft or
  reuse, bypassing email verification or two-factor, session fixation, password reset
  flaws, sign-in rate limits that can be sidestepped.
- **Course access.** Opening lessons, video playback sessions, PDFs, resources, quiz
  questions or answer keys of a course you are not entitled to: not enrolled, an expired
  grant, a refunded order, an ended subscription, or another instructor's course.
- **Payments.** Getting a course, bundle or plan without paying the priced amount:
  forged or replayed Stripe, Razorpay or EVS webhooks, a client-chosen amount or
  currency, coupon limits that can be exceeded, double fulfilment, refunds beyond the
  order total, reading another learner's orders or invoices.
- **Assessments.** Seeing answer keys before the reveal policy allows, scoring points with
  answers that are not in the attempt, exceeding attempt limits or time limits, editing
  a submission after review, grading a course you are not staff on.
- **Media uploads.** Uploading content types or sizes the API should refuse, reading
  another learner's submission files, presigned URLs that grant more than one object or
  outlive their purpose, stored XSS through file names, markdown or metadata.
- **Admin control plane.** Reaching an /admin area your role does not have, changing roles,
  settings, enrollments or refunds without the permission, or tampering with the audit log.

Out of scope:

- **What staff can already see.** Admins and support staff can open every course and
  learner record, and course staff can read their learners' submissions. Reports that rely
  on that access are out of scope; reports that let someone gain it are very much in scope.
- **The demo seed.** `make demo` creates well-known demo accounts on purpose and
  refuses to run with `NODE_ENV=production`.
- **The moderation stub** (`apps/stubs`), a test double that never runs in
  production.
- Findings that require a compromised host, compromised AWS account, or leaked
  deployment secrets.
- Denial of service through resource exhaustion of a deployment you operate yourself.
- Content moderation quality (a false negative of the rules or the AI provider) unless
  it comes from a bug that skips moderation altogether.

## Hardening checklist for operators

- Deploy with the Terraform in `infra/terraform` (or match it): private subnets, TLS
  everywhere, encryption at rest with a customer-managed key, Redis with TLS and an AUTH
  token, secrets only in Secrets Manager.
- Keep `NODE_ENV=production`: the API refuses to boot with development secrets, local
  storage, the mail outbox or the moderation stub.
- Serve the web app and the API on one HTTPS host so the refresh cookie stays
  first-party and `Secure`.
- Enable CloudFront and WAF (`enable_cdn`, on in `aws-prod`) for public deployments.
- Subscribe someone to the alarm topic (`alarm_email`).
