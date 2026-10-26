## What and why

<!-- One paragraph: the problem, and how this change solves it. Link the issue. -->

## How it was verified

- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] `make test-integration` (if API, database, queue, payment, video or mail code changed)
- [ ] `make test-matrix` (if storage, mail or AI backends changed)
- [ ] `make e2e` (if a user flow or the infrastructure changed)
- [ ] `make tf-validate tf-lint tf-security` (if Terraform changed)

## Checklist

- [ ] Docs updated (`docs/`, the configuration reference) for any behavior or config change
- [ ] `pnpm openapi` re-run if a route changed
- [ ] New migration instead of editing an applied one
- [ ] Access stays scoped: paid lessons, quiz answers, submissions and grades are visible only to the enrolled learner, the course's instructors and admins (covered by a test)
- [ ] Money paths stay idempotent: a replayed or out-of-order Stripe or Razorpay webhook never double-enrolls or double-refunds
- [ ] AI output is only ever a draft a person accepts
- [ ] No secrets, account ids, real emails or hostnames (`make sanitize` is clean)
- [ ] Security-relevant change? Described the threat and mitigation above
