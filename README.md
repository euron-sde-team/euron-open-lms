<p align="center">
  <img src="docs/assets/banner.svg" alt="Euron Open LMS: courses, a classroom, quizzes, reviewed projects, certificates and billing, on infrastructure you own" width="100%">
</p>

<p align="center">
  <img alt="Open source" src="https://img.shields.io/badge/open_source-%E2%9D%A4-0e99ad?style=flat">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3b82f6?style=flat"></a>
  <img alt="Node.js 22 LTS" src="https://img.shields.io/badge/node-22_LTS-339933?style=flat&logo=nodedotjs&logoColor=white">
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat&logo=typescript&logoColor=white">
  <img alt="Next.js 15" src="https://img.shields.io/badge/Next.js-15-000000?style=flat&logo=nextdotjs&logoColor=white">
  <img alt="PostgreSQL 16" src="https://img.shields.io/badge/PostgreSQL-16-4169e1?style=flat&logo=postgresql&logoColor=white">
  <img alt="Redis 7" src="https://img.shields.io/badge/Redis-7-dc382d?style=flat&logo=redis&logoColor=white">
  <img alt="Stripe" src="https://img.shields.io/badge/payments-Stripe-635bff?style=flat&logo=stripe&logoColor=white">
  <img alt="Razorpay" src="https://img.shields.io/badge/payments-Razorpay-0c2451?style=flat&logo=razorpay&logoColor=white">
  <img alt="Terraform" src="https://img.shields.io/badge/IaC-Terraform-7b42bc?style=flat&logo=terraform&logoColor=white">
  <img alt="AWS" src="https://img.shields.io/badge/AWS-ready-ff9900?style=flat&logo=amazonwebservices&logoColor=white">
</p>

<p align="center">
  <a href="https://github.com/euron-sde-team/euron-open-lms/stargazers"><img alt="Star this repo" src="https://img.shields.io/github/stars/euron-sde-team/euron-open-lms?style=social&label=Star%20this%20repo"></a>
  <a href="https://github.com/euron-sde-team/euron-open-lms/fork"><img alt="Fork" src="https://img.shields.io/github/forks/euron-sde-team/euron-open-lms?style=social&label=Fork"></a>
  <a href="https://github.com/euron-sde-team/euron-open-lms/watchers"><img alt="Watch" src="https://img.shields.io/github/watchers/euron-sde-team/euron-open-lms?style=social&label=Watch"></a>
  <br>
  <a href="https://github.com/euron-sde-team/euron-open-lms/issues"><img alt="Open issues" src="https://img.shields.io/github/issues/euron-sde-team/euron-open-lms?style=flat&color=0e99ad"></a>
  <a href="https://github.com/euron-sde-team/euron-open-lms/pulls"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-34d399?style=flat"></a>
  <a href="https://github.com/euron-sde-team/euron-open-lms/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/euron-sde-team/euron-open-lms?style=flat&color=8b95a8"></a>
  <img alt="Runs locally with no AWS account" src="https://img.shields.io/badge/runs_locally-no_AWS_account_needed-0a0f1c?style=flat">
  <br>
  <a href="#built-by-the-team-behind-euron"><img alt="Built by the team behind Euron" src="https://img.shields.io/badge/built_by-Euron-4f46e5?style=flat"></a>
</p>

<p align="center">
  <b><a href="#-quickstart">Quickstart</a></b> ·
  <b><a href="#️-architecture">Architecture</a></b> ·
  <b><a href="#-explore-the-repository">Explore the repo</a></b> ·
  <b><a href="docs/api/rest-contract.md">API reference</a></b> ·
  <b><a href="#️-deploy-to-aws">Deploy</a></b> ·
  <b><a href="docs/architecture/security.md">Security</a></b> ·
  <b><a href="#-documentation">Docs</a></b>
</p>

**Euron Open LMS** is an open-source, self-hosted **learning platform for an academy, a
training team or a creator who sells courses**: a course catalog, a classroom people actually
finish courses in, quizzes, reviewed projects, certificates anyone can verify, and billing with
Stripe and Razorpay, all on infrastructure you own. It is MIT-licensed and part of the
open-source initiative of **ENGAGESPHERE TECHNOLOGY PRIVATE LIMITED**.

Learners browse and search the catalog, buy a course or a bundle or subscribe to an all-access
plan, and learn in a focused classroom: video, articles and PDFs with notes, bookmarks and
lecture Q&A, quizzes with server-side timers, and assignments a person reviews against a
rubric. Finishing a course issues a certificate with a public verify page. Instructors build
courses with a drag-and-drop curriculum builder and grade from one queue. Academy staff run
everything from an `/admin` control plane: courses, learners and grants, orders and refunds,
plans, coupons, certificates, moderation, settings and the audit log.

The rules that keep paid content paid are enforced by the server, not left to the UI:

- **One function decides who may open a course.** Every content route (curriculum, playback,
  progress, quizzes, assignments, notes, Q&A, reviews, certificates) asks the same pure
  function, so there is no side door.
- **One path turns a payment into access.** The signed webhook and the browser's return both
  call one idempotent fulfilment, which checks the amount against the order before it grants
  anything.
- **Video is minted, not linked.** Playback sessions come from the lecture row after the
  access check, never from an id the browser sends.

Video upload and transcoding are not rebuilt here: lectures stream from a running
[euron-video-system](https://github.com/euron-sde-team/euron-video-system) deployment, our
open-source video platform, or from any HLS or MP4 URL or YouTube.

Everything runs on a laptop against an AWS emulator and stand-ins for Stripe, Razorpay and
the video system, and deploys to AWS with one command from the same Terraform.

<p align="center">
  <img src="docs/assets/tour.gif" alt="Product tour: the home page, the catalog, a course page, plans, the classroom playing a lecture, a quiz, checkout in INR, the admin overview, the curriculum builder, grading, an order with a refund and dark mode" width="100%">
</p>

> [!NOTE]
> Everything in the tour ran for real: Docker Compose on a laptop, with S3, SES, KMS and
> Secrets Manager emulated locally and provisioned by the same Terraform modules that build
> production, and payments signed with the same verification code that runs against Stripe
> and Razorpay. `make up && make demo` reproduces it.

<h3 align="center">Built by the team behind Euron</h3>

<p align="center">
  <sub>Euron Open LMS is part of the open-source initiative of ENGAGESPHERE TECHNOLOGY PRIVATE LIMITED, made by the people who build<br>the platforms below. If you like how this repository is built, come and see what we build with it.</sub>
</p>

<p align="center">
  <a href="https://euron.one"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/euron-dark.svg"><img src="docs/assets/brand/euron-light.svg" alt="Euron: learn the latest technologies from industry experts. Visit euron.one" width="31%"></picture></a>
  <a href="https://euronsystems.com"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/euron-systems-dark.svg"><img src="docs/assets/brand/euron-systems-light.svg" alt="Euron Systems: the SaaS platform for educators and creators. Visit euronsystems.com" width="31%"></picture></a>
  <a href="https://alphaeuron.com"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/alpha-euron-dark.svg"><img src="docs/assets/brand/alpha-euron-light.svg" alt="Alpha Euron: where school kids grow creativity and tech skills with AI. Visit alphaeuron.com" width="31%"></picture></a>
</p>

<p align="center">
  <a href="https://www.instagram.com/euron_official"><img src="https://img.shields.io/badge/Instagram-E4405F?style=flat-square&logo=instagram&logoColor=white" alt="Instagram"></a>
  <a href="https://www.linkedin.com/company/euronone/posts/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white" alt="LinkedIn"></a>
  <a href="https://x.com/euron712"><img src="https://img.shields.io/badge/X-000000?style=flat-square&logo=x&logoColor=white" alt="X"></a>
  <a href="https://www.youtube.com/@Euron-official"><img src="https://img.shields.io/badge/YouTube-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://whatsapp.com/channel/0029VaeeJwq9RZAfPW9P2l07"><img src="https://img.shields.io/badge/WhatsApp_channel-25D366?style=flat-square&logo=whatsapp&logoColor=white" alt="WhatsApp channel"></a>
</p>

---

## 📚 Table of contents

- [Why Euron Open LMS](#-why-euron-open-lms)
- [At a glance](#-at-a-glance)
- [Screenshots](#️-screenshots)
- [Features](#-features)
- [Architecture](#️-architecture)
  - [Who may open a course](#who-may-open-a-course)
  - [From checkout to access](#from-checkout-to-access)
  - [Classroom playback](#classroom-playback)
  - [Quizzes and assignments](#quizzes-and-assignments)
  - [A request, end to end](#a-request-end-to-end)
  - [Data model](#data-model)
- [Tech stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Quickstart](#-quickstart)
- [Explore the repository](#-explore-the-repository)
- [API](#-api)
- [Configuration](#️-configuration)
- [Deploy to AWS](#️-deploy-to-aws)
- [Security model](#-security-model)
- [Testing](#-testing)
- [Documentation](#-documentation)
- [Roadmap](#️-roadmap)
- [FAQ](#-faq)
- [Contributing, security and license](#-contributing-security-and-license)

---

## 💡 Why Euron Open LMS

Hosted course platforms take a share of every sale, own the relationship with your learners,
and decide what your certificates and your checkout look like. Most self-hosted ones were
built before subscriptions, two-currency pricing and signed webhooks were table stakes, and
leave the hard parts (who may see paid content, what happens when a webhook arrives twice)
to plugins.

Euron Open LMS is a complete academy you run yourself, with those hard parts done and tested:

- **A classroom people finish courses in.** A video player with quality, speed, captions,
  keyboard shortcuts and a resume point; articles and PDFs; notes on the timeline; a curriculum
  sidebar with progress rings; next and previous; a celebration when a course is done.
- **Assessment that means something.** Quizzes graded on the server from a frozen snapshot of
  each attempt, with time limits and attempt caps; assignments reviewed against a rubric, with
  versions, change requests and an optional AI draft that a person must confirm.
- **Billing that survives real gateways.** Stripe and Razorpay behind one interface, purchases
  and subscriptions, a price book per currency, coupons, inclusive or exclusive tax, gap-free
  invoice numbers, refunds with credit notes, and webhooks that are verified, deduplicated and
  replay-safe.
- **Certificates anyone can check.** Issued only when every required item is complete, with a
  serial and a public verify page that also shows revocations.
- **Production-grade on AWS in one command.** VPC, RDS, ElastiCache, S3 with KMS, SES, ECS
  Fargate, CloudFront with WAF, alarms. The same modules provision the local emulator.

## 📊 At a glance

| | |
|---|---|
| **Apps** | Web app (Next.js) with the `/admin` control plane, API, background worker, and a stubs server standing in for Stripe, Razorpay, OpenAI and euron-video-system |
| **Learning** | Catalog with full-text search and filters, course pages, My Learning, a classroom for video, articles and PDFs, notes, bookmarks, lecture Q&A, reviews, certificates with public verification |
| **Assessment** | A question bank, quizzes with server-side timers and attempt policies, assignments with rubrics, versions and a grading queue, AI drafts for questions and grades |
| **Commerce** | Stripe and Razorpay, course and bundle purchases, an all-access subscription, a per-currency price book, coupons, tax, invoices, refunds and credit notes |
| **Mobile app** | A React Native learner app for iOS and Android in [euron-open-lms-mobile-application](https://github.com/euron-sde-team/euron-open-lms-mobile-application), served by this API: native sessions, push notifications, offline downloads |
| **Infrastructure** | 13 Terraform modules, 3 environments (local emulator, AWS dev, AWS prod) |
| **Tests** | 573 unit, 311 integration (run under 12 backend combinations), 18 browser end-to-end |
| **License** | MIT |

## 🖼️ Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/01-catalog.png" alt="The course catalog with search, category, level and price filters and a grid of course cards with ratings and prices"><br><sub><b>Catalog.</b> Full-text search, filters that live in the URL, ratings and prices in the learner's currency.</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/02-course.png" alt="A course page with the hero, outcomes and a sticky purchase card with price, coupon and what is included"><br><sub><b>Course page.</b> Outcomes, instructors and reviews, with a purchase card that stays in view.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/03-curriculum.png" alt="The curriculum accordion on a course page with sections, lecture durations and free preview lectures"><br><sub><b>Curriculum.</b> Sections and items with durations; free previews play before you buy.</sub></td>
    <td><img src="docs/assets/screenshots/04-plans.png" alt="The all-access plan page with monthly and yearly prices"><br><sub><b>Plans.</b> An all-access subscription, monthly or yearly, in each enabled currency.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/06-my-learning.png" alt="My Learning with continue learning, courses in progress with progress bars, and completed courses"><br><sub><b>My Learning.</b> Continue where you stopped, in progress, completed, saved and certificates.</sub></td>
    <td><img src="docs/assets/screenshots/07-classroom-video.png" alt="The classroom playing a video lecture with the curriculum sidebar and progress rings"><br><sub><b>Classroom.</b> The player, the curriculum with progress rings, overview, notes, Q&A and resources.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/08-quiz.png" alt="A quiz in progress with the question palette and a countdown timer"><br><sub><b>Quiz.</b> A question palette, a timer the server enforces, a review step and results.</sub></td>
    <td><img src="docs/assets/screenshots/11-article-notes.png" alt="An article lecture with the notes tab open"><br><sub><b>Articles and notes.</b> Sanitised articles, and private notes for every lecture.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/09-checkout-inr.png" alt="Checkout in Indian rupees with GST added and Razorpay as the payment method"><br><sub><b>Checkout.</b> Priced on the server from the price book, with coupons and tax; INR through Razorpay here.</sub></td>
    <td><img src="docs/assets/screenshots/10-orders.png" alt="The account orders page with paid orders and invoice downloads"><br><sub><b>Orders and invoices.</b> Every order with its invoice, credit notes for refunds, and the subscription.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/05-verify.png" alt="The public certificate verification page showing a valid certificate"><br><sub><b>Verify a certificate.</b> A public page per serial; revoked certificates say so.</sub></td>
    <td><img src="docs/assets/screenshots/12-admin-overview.png" alt="The admin overview with revenue, recurring revenue, enrollments, completions and daily charts"><br><sub><b>Control plane.</b> Revenue, MRR, enrollments, completions, top courses and refunds, with CSV export.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/13-admin-curriculum.png" alt="The admin curriculum builder with draggable sections and items"><br><sub><b>Curriculum builder.</b> Drag sections and items, including between sections; lectures, quizzes and assignments.</sub></td>
    <td><img src="docs/assets/screenshots/14-admin-grading.png" alt="Grading an assignment submission against a rubric with an AI suggestion"><br><sub><b>Grading.</b> Score each rubric criterion; an AI draft can help, a person decides.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/15-admin-order-refund.png" alt="An order in the admin with its gateway timeline and a refund"><br><sub><b>Orders and refunds.</b> The gateway timeline for every order, full and partial refunds with a reason.</sub></td>
    <td><img src="docs/assets/screenshots/17-admin-learners.png" alt="The admin learners list with search and enrollment counts"><br><sub><b>Learners.</b> Search, enrollments, grants with an expiry, revocation and progress.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/16-admin-settings.png" alt="Admin settings for branding, currencies and gateway routing, tax and learning rules"><br><sub><b>Settings.</b> Branding, currencies and gateway routing, tax, completion rules, AI and the video connection.</sub></td>
    <td><img src="docs/assets/screenshots/18-dark-course.png" alt="A course page in dark mode"><br><sub><b>Dark mode.</b> Every screen, following the system setting or your choice.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/19-mobile-classroom.png" alt="The classroom on a phone"><br><sub><b>Mobile classroom.</b> The player and the curriculum down to phone width.</sub></td>
    <td><img src="docs/assets/screenshots/20-mobile-home.png" alt="The home page on a phone"><br><sub><b>Mobile.</b> Every screen works on a phone.</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/assets/screenshots/00-home.png" alt="The signed-out home page with featured courses and categories"><br><sub><b>Home.</b> Featured courses, categories and the plan, for visitors and learners alike.</sub></td>
  </tr>
</table>

## ✨ Features

| Area | What you get |
|---|---|
| **Catalog** | Courses with outcomes, prerequisites, level, language and duration; categories; bundles; full-text and trigram search with filters for category, level, language, price, rating and duration; keyset "load more"; JSON-LD, a sitemap and Open Graph images |
| **Course page** | A hero with a sticky purchase card, a tab strip with scroll-spy, the curriculum with free previews, instructors, reviews with a rating breakdown |
| **Classroom** | A hls.js player with quality, speed, captions, keyboard shortcuts, a watermark and resume; articles and PDFs; resources; notes on the timeline; bookmarks; lecture Q&A with accepted answers; next, previous and autoplay; progress rings and a completion celebration |
| **Video** | [euron-video-system](https://github.com/euron-sde-team/euron-video-system) playback sessions minted after the access check, a picker for its library, `video.ready` webhooks; or any HLS or MP4 URL, or YouTube (privacy-enhanced embed) |
| **Quizzes** | A question bank (single, multiple, true or false, short text with exact or pattern match), picked or random questions, pass mark, time limit, attempt caps, shuffling, a reveal policy, server-side grading from a frozen attempt snapshot |
| **Assignments** | Sanitised instructions, rubrics with points per criterion, due dates and a late policy, text, files or repository links, versions, approve, request changes or reject, AI drafts a person must confirm |
| **Certificates** | Issued on completion, PDF rendered in-process, a serial with a public verify page, revocation with a reason, signatory and logo from settings |
| **Community** | Reviews from learners who are at least 20% through, Q&A threads per lecture, reports, and a moderation queue to hide or restore |
| **Commerce** | Stripe Checkout and Billing, Razorpay Orders and Subscriptions, gateway routing per currency, a price book in minor units, coupons with scopes and limits, inclusive or exclusive tax, gap-free invoices, refunds and credit notes, reconciliation of lost webhooks |
| **Account center** | Profile and avatar, email change with a code, password, two-factor sign-in with recovery codes, sessions, orders and invoices, the subscription (cancel at period end, resume, change plan), notification preferences, data export, account deletion |
| **Control plane** | Role-scoped areas for admins, support, finance and instructors: overview with CSV export, courses and the curriculum builder, learners and grants, grading, orders and refunds, plans and bundles, coupons, certificates, moderation, staff and roles, settings, audit log |
| **Mobile app** | [euron-open-lms-mobile-application](https://github.com/euron-sde-team/euron-open-lms-mobile-application) for iOS and Android: native sessions with a keystore-held refresh token, push notifications through FCM with per-category switches, offline video downloads that are revalidated against access and revocable from `/admin`, Stripe and Razorpay checkout handed back to the app |
| **AI** | Quiz questions from a lecture, grade suggestions against a rubric, description polish; OpenAI by default, Gemini, a stub, or off; every result is a draft |

## 🏗️ Architecture

<p align="center">
  <img src="docs/assets/diagrams/context.svg" alt="Visitors, learners, instructors, staff and the operator use one web app backed by the API, a worker, Postgres and Redis; the API calls Stripe, Razorpay, euron-video-system, S3, mail and an optional AI provider, and the first three send signed webhooks back" width="100%">
</p>

- **One origin for the browser.** The load balancer routes `/api/*` and `/up` to the API and
  everything else to the web app, so the refresh cookie is first-party and there is no CORS
  in production ([deployment diagram](docs/assets/diagrams/deployment-aws.svg)).
- **Bytes bypass the API.** Uploads go straight to a private S3 bucket with presigned URLs,
  video streams from euron-video-system, and card details stay on the gateway's page.
- **The worker does the slow work.** Invoices and certificates, receipts and notifications,
  AI drafts, webhook reconciliation and subscription expiry run on BullMQ queues in a
  separate service built from the same image.
- **Side effects only after commit.** Jobs and emails are collected during a transaction and
  released only when it commits ([`core/effects.ts`](apps/api/src/core/effects.ts)), so no
  learner is emailed a receipt for an order that rolled back.

### Who may open a course

<p align="center">
  <img src="docs/assets/diagrams/entitlements.svg" alt="decideAccess checks, in order: signed in; course staff or admin and support; an active account; a published course; an enrollment by its source; an active plan for included courses; otherwise denied with the lapsed reason" width="100%">
</p>

The policy is one pure function, [`decideAccess`](apps/api/src/domain/entitlements.ts), and
the order of its checks is the policy: course staff always get in (so they can author drafts);
learners need a published course and an active account; an enrollment grants access by its
source (a purchase or grant until `valid_until`, a subscription enrollment only while the plan
does, a refunded one never); and with no usable enrollment an active plan still unlocks the
included courses. A denial carries its reason, so the course page can say "Your access
expired" instead of "Buy now". Every content route reaches it through
[`access.service.ts`](apps/api/src/services/access.service.ts). Details in
[docs/architecture/entitlements.md](docs/architecture/entitlements.md).

### From checkout to access

<p align="center">
  <img src="docs/assets/diagrams/checkout-and-webhooks.svg" alt="The browser gets a quote, starts a checkout with an idempotency key; the API creates a pending order and a Stripe session or Razorpay order; the signed webhook is verified and stored once, then fulfilOrder locks the order, checks the amount, marks it paid, grants access and issues the invoice; the browser's return calls fulfilOrder too; a reconcile job covers lost webhooks" width="100%">
</p>

The server prices every order from its own price book (the browser only says what and in which
currency), applies the coupon and then tax, all in integer minor units. Webhooks are verified
over the raw body in constant time and stored once by `(gateway, event_id)`; then the webhook
and the browser's return both call
[`fulfilOrder`](apps/api/src/services/payments/fulfilment.service.ts), which locks the order,
checks the amount and currency, moves it with a conditional update and grants access once.
A late "payment failed" can never undo a paid order. The full model, with refunds,
subscriptions and invoices, is in [docs/architecture/payments.md](docs/architecture/payments.md)
and [docs/api/webhooks.md](docs/api/webhooks.md).

### Classroom playback

<p align="center">
  <img src="docs/assets/diagrams/classroom-playback.svg" alt="The player asks the API for playback; the API runs decideAccess, checks the lecture is a ready video, then mints a euron-video-system playback session; the browser plays straight from it and sends heartbeats; at 90 percent the item completes and may issue the certificate" width="100%">
</p>

The browser never names a video: it asks to play a lecture, and the API reads the video
reference from the lecture row after the access check, then mints a short-lived, watermarked
session in [euron-video-system](https://github.com/euron-sde-team/euron-video-system).
Heartbeats are capped against wall-clock time, so a learner cannot claim an hour in a minute,
and an item completes at 90% watched (configurable). Connecting a video system takes two
keys, described in [docs/guides/video-with-evs.md](docs/guides/video-with-evs.md).

### Quizzes and assignments

<p align="center">
  <img src="docs/assets/diagrams/assessments.svg" alt="A quiz attempt freezes a snapshot of questions and the key, enforces the deadline on the server and is graded from the snapshot; an assignment submission is a version that waits in the grading queue, may get an AI draft, and is approved, sent back or rejected" width="100%">
</p>

A quiz attempt freezes its questions, option order, points and answer key when it starts, so
editing a question never changes a grade, and the key never leaves the server before the
reveal policy allows ([`domain/quiz.ts`](apps/api/src/domain/quiz.ts)). Assignment reviews
are conditional status moves on a submission version; an AI suggestion is stored next to the
grader's final scores and never applied by itself. Details in
[docs/architecture/assessments.md](docs/architecture/assessments.md) and
[progress-and-certificates.md](docs/architecture/progress-and-certificates.md).

### A request, end to end

<p align="center">
  <img src="docs/assets/diagrams/request-lifecycle.svg" alt="A request gets an id, a log line, security headers and origin checks; webhooks branch off with a raw body and verify first; others are authenticated, rate limited, parsed by a strict schema and run in a transaction, with effects enqueued after commit" width="100%">
</p>

### Data model

<p align="center">
  <img src="docs/assets/diagrams/data-model.svg" alt="The tables grouped by domain: identity, catalog, curriculum, assessments, commerce, learning, community and platform, with the constraints that carry rules" width="100%">
</p>

48 tables in one SQL migration, where the constraints carry the rules: one live subscription
per learner, one open quiz attempt, one active price per item and currency, webhook
deduplication, dense curriculum positions, gap-free invoice numbers. See
[docs/architecture/data-model.md](docs/architecture/data-model.md).

## 🧰 Tech stack

| Layer | Choice |
|---|---|
| Web | Next.js 15 (App Router), React 19, TanStack Query, Radix UI, Tailwind CSS, hls.js, dnd-kit |
| API | Node.js 22, Express 5, Kysely on PostgreSQL 16 (full-text and trigram search), zod |
| Jobs | BullMQ on Redis 7 |
| Payments | Stripe (Checkout and Billing) and Razorpay (Orders, Checkout and Subscriptions) behind one gateway interface |
| Video | [euron-video-system](https://github.com/euron-sde-team/euron-video-system) playback sessions, or HLS, MP4 and YouTube |
| AI | OpenAI (default), Gemini, a stub or none, behind one interface |
| Documents | pdfkit for invoices, credit notes and certificates |
| Mail | Amazon SES (or SMTP, or a local outbox) |
| Infrastructure | Terraform, ECS Fargate, ALB, CloudFront and WAF, RDS, ElastiCache, S3, KMS, SES, Secrets Manager, CloudWatch |
| Local AWS | The Floci emulator (S3, SES, KMS, Secrets Manager) and Mailpit ([ADR 0010](docs/architecture/adr/0010-floci-for-local-aws.md)) |
| Tooling | pnpm workspaces, Turborepo, TypeScript strict, Vitest, Playwright, ESLint, Prettier |

## 📋 Prerequisites

- Docker with Compose v2 (about 4 GB of memory for the containers)
- Node.js 22 and pnpm 9 (only to run tests or develop outside Docker)
- For AWS: an account, a domain in Route 53 with an ACM certificate, and Terraform 1.10 or later
- For real payments: a Stripe account, a Razorpay account, or both ([docs/guides/payments.md](docs/guides/payments.md))

No AWS account, no payment account, no video system and no AI key are needed to run it locally.

## 🚀 Quickstart

```bash
git clone https://github.com/euron-sde-team/euron-open-lms.git
cd euron-open-lms
make up      # builds the images, starts Floci, Postgres, Redis, Mailpit, the stubs and the app
make demo    # seeds a fictional academy: courses, instructors, learners, orders, reviews
```

| What | Where |
|---|---|
| The app | http://localhost:3530 |
| Mail (verification codes, receipts, grading outcomes) | http://localhost:8046 |
| API readiness | http://localhost:5026/api/ready |
| Stubs (Stripe, Razorpay, AI and video stand-ins) | http://localhost:5119 |

`make demo` seeds Northwind Academy and prints the demo accounts and their shared password:

| Account | Try |
|---|---|
| `juniper.vale@example.com` | A learner with a subscription: My Learning, the classroom, a quiz, a certificate |
| `rohan.mehta@example.com` | A learner in India: checkout in INR through Razorpay with GST, orders and invoices |
| `maya.okafor@example.com` | An instructor: three courses they own, the curriculum builder, the grading queue |
| `admin@example.com` | The control plane: everything, including settings and the audit log |
| `finance@example.com` | Finance: orders and refunds, plans and bundles, coupons |
| `support@example.com` | Support: learners, grading, orders (read only), certificates, moderation |

Buy a course as any learner: the stand-in Stripe page and Razorpay modal sign their webhooks
with the same secrets the API verifies, so the real fulfilment code runs. Try the coupon
`WELCOME20`. Sign up with any address to see the email flows: they land in Mailpit.
`make down` stops everything and deletes the local data. The full walkthrough is in
[docs/guides/quickstart-local.md](docs/guides/quickstart-local.md).

## 🧭 Explore the repository

```
apps/
  api/              Express API, BullMQ worker, CLI (admin:create, demo:seed)
    src/routes/         URL + guards, one line per endpoint
    src/controllers/    parse the request (zod, strict), call one service, respond
    src/services/       business rules, transactions, after-commit effects
      payments/           the gateway interface, Stripe, Razorpay, webhooks, fulfilment
    src/repositories/   every SQL query, each accepting a transaction
    src/presenters/     rows to API shapes, batched, signed media URLs
    src/domain/         pure rules: entitlements, pricing, orders, quiz, progress, curriculum, rubric
    src/integrations/   euron-video-system, the AI providers, mail and storage
    src/jobs/           queue handlers: billing, learning, assessment, maintenance
    src/demo/           the Northwind Academy seed
  web/              Next.js app: catalog, course pages, checkout, My Learning, classroom,
                    account center, /admin control plane
  stubs/            Stripe, Razorpay, OpenAI and euron-video-system stand-ins for local and tests
packages/
  types/            the API contract: request and response shapes
  api-client/       typed client with token refresh and uploads
  ui/               design system: tokens, light and dark, Radix components
db/migrations/      the schema (SQL), applied by a checksummed runner
infra/terraform/    13 modules and 3 environments; infra/docker: the images
deploy/compose/     the local stack (Floci overlay, real-AWS overlay)
e2e/                Playwright suites against the full stack
docs/               architecture, ADRs, guides, the API reference
```

Start reading at [docs/guides/walkthrough.md](docs/guides/walkthrough.md): it follows a
learner from the catalog to a certificate, and an instructor from an empty course to a graded
project, naming the file at every step.

## 🔌 API

REST under `/api`, on the same origin as the web app.

- [docs/api/rest-contract.md](docs/api/rest-contract.md): every endpoint, its access level, body, response and error codes.
- [docs/api/openapi.yaml](docs/api/openapi.yaml): the OpenAPI 3.1 reference for all 182 operations, generated from the route files (`make openapi`, with a drift check in CI).
- [docs/api/webhooks.md](docs/api/webhooks.md): the Stripe, Razorpay and euron-video-system events the API accepts, and how each is verified.

```bash
# sign in, then call the API with the access token
TOKEN=$(curl -s localhost:5026/api/auth/login -H 'content-type: application/json' \
  -d '{"login":"juniper.vale@example.com","password":"<demo password>"}' | jq -r .accessToken)
curl -s "localhost:5026/api/my/learning" -H "authorization: Bearer $TOKEN" | jq
```

## ⚙️ Configuration

Every environment variable is declared and validated in one place,
[`apps/api/src/core/config.ts`](apps/api/src/core/config.ts), and documented in
[docs/guides/configuration.md](docs/guides/configuration.md). In production the API refuses to
start with a development secret, an open CORS policy, local storage, an outbox mailer or the
stub AI provider, and warns about payment or video keys still set to placeholders.

Academy policy (branding, enabled currencies and which gateway serves each, tax rates and
whether prices include tax, the completion threshold, the subscription grace period,
certificate signatory, registration) is changed by admins in the control plane, not in
environment variables.

## ☁️ Deploy to AWS

```bash
cd infra/terraform/envs/aws-dev
cp terraform.tfvars.example terraform.tfvars    # name_prefix, domain, route53 zone, certificate
cd -
make aws-deploy ENV=aws-dev                     # registries, images, infrastructure, migrations, rollout
make aws-admin ENV=aws-dev EMAIL=you@example.com   # emails you a link to set the admin password
```

`aws-deploy` builds and pushes the images, applies the Terraform, runs the migrations as a
one-off task and waits for the services to be stable. `aws-dev` is sized small (one NAT
gateway, single-node Redis, no CDN); `aws-prod` adds three availability zones, Multi-AZ
database and cache, CloudFront with WAF, autoscaling and deletion protection.

Gateway, video and AI keys live in Secrets Manager. Put your Stripe and Razorpay keys and
webhook secrets there, point each gateway's webhook at `https://<your domain>/api/webhooks/...`
as described in [docs/guides/payments.md](docs/guides/payments.md), and add the
euron-video-system keys to stream video. Read [docs/guides/deploy-aws.md](docs/guides/deploy-aws.md)
before the first deploy: it covers SES production access, sizing, updates, rollbacks and teardown.

## 🔐 Security model

- **Identity from the token, never the body.** Request bodies are validated with strict zod
  schemas, and every id in a body is checked against its parent, so a lecture from another
  course or a question from another quiz is rejected, not trusted.
- **Access in one place.** `decideAccess` behind every content route; answer keys, video
  references and private files never reach someone without access.
- **Payments:** prices from the server's price book, signatures verified over the raw body in
  constant time, events deduplicated, conditional order moves, amount checks, one idempotent
  fulfilment, coupons redeemed at payment under a conditional update.
- **Sessions:** short-lived access tokens kept only in memory; refresh tokens in an httpOnly
  cookie, rotated on every use, with reuse detection that revokes the whole session family.
- **Accounts:** email verification, two-factor sign-in with encrypted secrets and recovery
  codes, throttled sign-in that never reveals whether an account exists.
- **Roles:** platform roles read from the database on every request, admin areas guarded per
  role, instructors fenced to their own courses, every admin write audited in its transaction.
- **Content:** markdown sanitised on the server, uploads by id with type and magic-byte checks,
  a private bucket with signed URLs, invoices and certificates private until requested.
- **Infrastructure:** private subnets, KMS everywhere, TLS-only bucket, Redis with TLS and a
  password, least-privilege task roles, WAF, and a CloudFront origin secret the load balancer checks.

Details, and an honest list of known limitations, are in
[docs/architecture/security.md](docs/architecture/security.md) and the
[threat model](docs/architecture/threat-model.md). To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## 🧪 Testing

| Suite | What it proves | Run |
|---|---|---|
| Unit (573) | Entitlements, pricing with coupons and tax, order moves, webhook signatures for both gateways, quiz grading and attempt policy, rubric totals, progress rollup, curriculum packing, safe URLs, the markdown sanitiser, the web app's state logic and components, the API client | `make test` |
| Integration (311) | The real API in-process against Postgres and Redis with the stubs: every route group, native sessions, push and offline downloads, an authorisation sweep (no entitlement, forged and cross-course ids, instructor fencing, expired grants and plans), webhook duplicates, late failures, amount mismatches and races, refunds, coupon races | `make test-integration` |
| Matrix (12 runs) | The integration suite under every backend: local or S3 storage, outbox, SMTP or SES mail, AI off or the stub | `make test-matrix` |
| Browser (18) | Sign-up, the catalog, free enrollment and the classroom, buying with Stripe, buying with Razorpay and a coupon, subscriptions, quizzes, assignment review, certificates, the course builder, refunds, reviews, Q&A and moderation, the access guard | `make e2e` |
| Infrastructure | `terraform validate` for three environments, tflint, checkov, shellcheck, gitleaks | `make tf-validate tf-lint tf-security` |

How to run each suite, and what the matrix covers, is in [docs/guides/testing.md](docs/guides/testing.md).

## 📖 Documentation

| Architecture | Guides |
|---|---|
| [High-level design](docs/architecture/HLD.md) | [Quickstart (local)](docs/guides/quickstart-local.md) |
| [Low-level design](docs/architecture/LLD.md) | [Local with real AWS](docs/guides/local-with-aws.md) |
| [Data model](docs/architecture/data-model.md) | [Deploy to AWS](docs/guides/deploy-aws.md) |
| [Entitlements](docs/architecture/entitlements.md) | [Configuration](docs/guides/configuration.md) |
| [Payments and webhooks](docs/architecture/payments.md) | [Payments: Stripe and Razorpay](docs/guides/payments.md) |
| [Video](docs/architecture/video.md) | [Video with euron-video-system](docs/guides/video-with-evs.md) |
| [Assessments](docs/architecture/assessments.md) | [Grading and moderation](docs/guides/grading-and-moderation.md) |
| [Progress and certificates](docs/architecture/progress-and-certificates.md) | [Operations](docs/guides/operations.md) |
| [Security](docs/architecture/security.md) and [threat model](docs/architecture/threat-model.md) | [Troubleshooting](docs/guides/troubleshooting.md) |
| [Decision records (22)](docs/architecture/adr/README.md) | [Testing](docs/guides/testing.md) |
| | [Walkthrough: a learner and an instructor, end to end](docs/guides/walkthrough.md) |

## 🗺️ Roadmap

- Live classes and cohorts with scheduled sessions
- Single sign-on (OIDC and SAML) for companies and universities
- SCORM and xAPI import and reporting
- Open Badges for certificates
- More gateways behind the same interface (PayPal, Adyen)
- Learning paths across courses, with prerequisites

Ideas and pull requests are welcome: open an issue to discuss larger changes first.

## ❓ FAQ

<details>
<summary><b>Is it multi-tenant?</b></summary>

No: one deployment is one academy, like Discourse or Mastodon. Run one per brand.
The reasoning is in [ADR 0001](docs/architecture/adr/0001-single-academy-per-deployment.md).
</details>

<details>
<summary><b>Where do videos get uploaded and transcoded?</b></summary>

In [euron-video-system](https://github.com/euron-sde-team/euron-video-system), our open-source
video platform: upload there, then pick the video on a lecture. The LMS only mints playback
sessions for learners who have access. Any HLS or MP4 URL or a YouTube video works too.
See [ADR 0015](docs/architecture/adr/0015-video-delegated-to-euron-video-system.md).
</details>

<details>
<summary><b>Is there a mobile app?</b></summary>

Yes: [euron-open-lms-mobile-application](https://github.com/euron-sde-team/euron-open-lms-mobile-application), a React Native learner app for iOS and
Android that talks to this API. It signs in with native sessions
([ADR 0020](docs/architecture/adr/0020-native-token-mode.md)), receives push notifications
when `PUSH_PROVIDER=fcm` ([ADR 0021](docs/architecture/adr/0021-push-through-fcm-http-v1.md))
and saves videos for offline viewing while access lasts
([ADR 0022](docs/architecture/adr/0022-offline-downloads-inside-a-playback-session.md)).
</details>

<details>
<summary><b>Do I need both Stripe and Razorpay?</b></summary>

No. Enable the currencies you sell in and choose a gateway for each: everything through
Stripe, everything through Razorpay, or INR through Razorpay and the rest through Stripe.
</details>

<details>
<summary><b>What happens if a webhook is lost, or arrives twice?</b></summary>

Twice is harmless: events are stored once by their id and fulfilment is idempotent. Lost is
covered twice over: the browser's return verifies the payment with the gateway and fulfils
the order itself, and a reconcile job asks the gateway about orders left pending.
</details>

<details>
<summary><b>Do I need an OpenAI key?</b></summary>

No. Without one, the AI buttons are hidden and everything else works the same. With a key,
instructors get draft quiz questions, grade suggestions and description polish, always as
drafts they accept; Gemini is a configuration change away.
</details>

<details>
<summary><b>Can I run it without Docker or without AWS?</b></summary>

Yes. The API needs Postgres and Redis; storage can be local disk, mail can be SMTP or an
outbox, and AI can be off. `make up` is simply the fastest way to see everything, including
the AWS services and the payment flows, working together.
</details>

<details>
<summary><b>Is the demo data real?</b></summary>

No. Every person, course and order is fictional, addresses use reserved example domains, and
every cover, avatar and image is generated by code.
</details>

## 🤝 Contributing, security and license

- Contributions: read [CONTRIBUTING.md](CONTRIBUTING.md) and the
  [code of conduct](CODE_OF_CONDUCT.md).
- Security issues: please report privately, as described in [SECURITY.md](SECURITY.md).
- License: [MIT](LICENSE).

Released under the [MIT License](LICENSE). Copyright (c) 2026 ENGAGESPHERE TECHNOLOGY
PRIVATE LIMITED and the Euron Open LMS contributors.

<p align="center">
  <sub>If Euron Open LMS is useful to you, <a href="https://github.com/euron-sde-team/euron-open-lms/stargazers">star the repository</a>: it helps others find it.</sub>
</p>
