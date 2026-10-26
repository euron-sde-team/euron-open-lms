# Contributing

Thanks for helping improve Euron Open LMS. This guide covers the workflow, the bar a
change has to clear, and the conventions the codebase follows.

## Ground rules

- **Open an issue first** for anything larger than a bug fix or a docs tweak, so we can
  agree on the approach before you invest time.
- **One concern per pull request.** A refactor and a feature are two PRs.
- **Security issues go through private reporting**, never a public issue. See
  [SECURITY.md](SECURITY.md).
- By contributing you agree your work is released under the [MIT License](LICENSE).

## Development setup

Requirements: Docker, Node 22+, pnpm 9 (`corepack enable`).

```bash
pnpm install
make up          # Postgres, Redis, the AWS emulator (provisioned by Terraform), Mailpit,
                 # the stubs (Stripe, Razorpay, AI, video), then migrate, api, worker and web
make demo        # the demo academy: courses, learners, orders, certificates
make test        # unit tests across every package
```

The app is at http://localhost:3530 and every mail it sends is readable at
http://localhost:8046. The README lists every port and how to change them.

## Before you open a pull request

Each of these must pass:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
make test-integration            # API (HTTP) against a real Postgres and Redis
make test-matrix                 # when you touched storage, mail or AI backends
make e2e                         # when you touched a user flow or infrastructure
make tf-validate tf-lint tf-security   # when you touched infra/terraform
pnpm openapi --check             # when you touched a route (pnpm openapi regenerates)
make sanitize                    # no credentials, account ids, real emails or IPs
```

## Conventions

**Layers (api).** Routes declare endpoints and guards; controllers read the request and
write the response; services hold the business rules; repositories are the only code that
touches the database. Background work (fan-out, media processing, moderation, mail) is a
BullMQ job enqueued after the transaction commits, never inline on the request path.
Pure rules (who may open a course, pricing, the order state machine, grading) live in
`apps/api/src/domain` and have unit tests.

**Access is decided in one place.** Who may open a course's content is
`domain/entitlements.ts`, reached only through `services/access.service.ts`. A new
endpoint that exposes course content goes through it and gets a test proving a
signed-out visitor, a learner who is not enrolled (or whose access lapsed) and an
instructor of another course cannot see it.

**Routes stay declarative.** One `router.<method>("<path>", ...guards, ctrl.fn);` per
endpoint with a `/** doc comment */` above: `scripts/gen-openapi.ts` builds
docs/api/openapi.yaml from exactly that shape.

**Configuration is validated.** Every environment variable is declared in
`apps/api/src/core/config.ts` and nowhere else; a new one is documented in `docs/` in the
same PR, and security-relevant ones are enforced at boot by `assertProductionConfig`.

**Database changes are new migrations.** Add `db/migrations/NNNN_description.sql` and update
`apps/api/src/db/types.ts`. Never edit an applied migration: the runner refuses to start
when a checksum changes.

**Comments explain why.** The code says what it does. Comments are for the constraint, the
incident, or the trade-off that made it this way.

**Style.** Prettier and ESLint settle formatting. TypeScript strict mode everywhere.

## Commit messages

Imperative mood with an optional scope: `dms: hide requests from blocked users`,
`web: keep the composer draft across reloads`. Explain the *why* in the body when it is not
obvious.

## Architecture decisions

A change that alters a documented decision (visibility model, moderation pipeline,
queue, payment gateway, deployment topology, layering) needs a short write-up in `docs/`
explaining the trade-off, linked from the pull request.
