# Architecture decision records

Short records of the decisions that shape Euron Open LMS: the context, what was decided,
and what it costs. The system as built is described in [HLD.md](../HLD.md) and
[LLD.md](../LLD.md).

| ADR | Decision |
| --- | --- |
| [0001](0001-single-academy-per-deployment.md) | One academy per deployment; no tenants |
| [0002](0002-relational-schema-timestamptz3-ulids.md) | Relational PostgreSQL schema, `timestamptz(3)`, ULID keys |
| [0003](0003-layered-repository-pattern.md) | Routes, controllers, services, domain, repositories, presenters |
| [0004](0004-keyset-pagination.md) | Keyset pagination with opaque cursors, no totals |
| [0005](0005-refresh-rotation-cookie-and-memory-token.md) | In-memory access token, rotating refresh token in an httpOnly cookie |
| [0006](0006-bullmq-on-redis.md) | BullMQ on Redis for background jobs |
| [0007](0007-after-commit-effects.md) | Side effects only after commit |
| [0008](0008-presigned-uploads-by-upload-id.md) | Direct-to-storage uploads, referenced by upload id only |
| [0009](0009-fargate-behind-one-alb.md) | Fargate services behind one ALB with path routing |
| [0010](0010-floci-for-local-aws.md) | Floci as the local AWS |
| [0011](0011-pluggable-ai-providers.md) | Pluggable AI providers (OpenAI, Gemini, a stub) and a no-AI mode |
| [0012](0012-entitlements-as-one-pure-function.md) | Course access decided by one pure function |
| [0013](0013-money-in-minor-units-with-a-server-price-book.md) | Money in integer minor units, priced only from a server price book |
| [0014](0014-one-fulfilment-path.md) | One fulfilment path for webhooks, returns and reconciliation |
| [0015](0015-video-delegated-to-euron-video-system.md) | Lecture video delegated to euron-video-system |
| [0016](0016-quiz-attempt-snapshots.md) | Quiz attempts graded against a frozen snapshot |
| [0017](0017-ai-drafts-never-auto-applied.md) | AI output is a draft a person accepts, never applied by itself |
| [0018](0018-gap-free-invoice-numbering.md) | Gap-free invoice and credit note numbers in the issuing transaction |
| [0019](0019-stubs-that-sign-with-real-secrets.md) | Local stand-ins for Stripe, Razorpay, OpenAI and EVS that sign with the real secrets |
