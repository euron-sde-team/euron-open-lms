# ADR 0009: Fargate services behind one ALB with path routing

## Status

Accepted.

## Context

A deployment runs two public applications (the Next.js web app and the API, which also
receives the Stripe, Razorpay and EVS webhooks), a worker with no inbound traffic, and two
one-off commands (migrations and the first administrator). The refresh cookie should be
first-party and the browser should not need CORS for its own API. The audience wants a
production AWS deployment without operating a container platform.

## Decision

- ECS on Fargate for `api`, `worker` and `web`, and one-off task definitions `migrate` and
  `admin` on the API image ([`infra/terraform/modules/deployment/main.tf`](../../../infra/terraform/modules/deployment/main.tf)).
- One public ALB, one host (`var.domain`): `/api/*` and `/up` go to the API (priority 100),
  everything else to the web app (priority 200). HTTP redirects to HTTPS; TLS policy
  `ELBSecurityPolicy-TLS13-1-2-2021-06` ([`modules/edge/main.tf`](../../../infra/terraform/modules/edge/main.tf)).
  No stickiness: every service is stateless.
- The webhook URLs are an output (`webhook_urls`) to paste into the gateway dashboards and
  EVS.
- Optional CloudFront with WAF (`enable_cdn`, on by default in aws-prod): a secret
  `X-Origin-Verify` header that the listener rules require, `/api/*` never cached and
  forwarded byte for byte so webhook signatures verify, `TRUST_PROXY` 2
  ([`modules/cdn/main.tf`](../../../infra/terraform/modules/cdn/main.tf)).
- Every service from one `service` module: its own security group (ingress only from the
  ALB), execution and task roles, read-only root filesystem with a writable `/tmp`, no
  public IP, ECS Exec disabled, circuit breaker with rollback, CPU target tracking at 60%
  ([`modules/service/main.tf`](../../../infra/terraform/modules/service/main.tf)).
- X86_64 by default; ARM64 is an input (`cpu_architecture`), and `scripts/aws-deploy.sh`
  builds the matching platform.

## Consequences

Positive:

- One origin: first-party cookie, no CORS for the app, one certificate, one place for
  webhooks.
- No nodes to patch; rollouts and rollbacks are ECS features.

Trade-offs:

- Web and API share one ALB and its limits.
- Without the CDN there is no WAF.
- No host access for debugging; logs only.

## Alternatives considered

- **Separate hosts for app and API.** Needs CORS and a cross-site cookie.
- **EKS.** A cluster to run for three services.
- **App Runner or Lambda.** Less network control; Lambda does not fit a long-running worker.
