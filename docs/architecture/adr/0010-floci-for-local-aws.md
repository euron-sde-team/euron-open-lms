# ADR 0010: Floci as the local AWS

## Status

Accepted.

## Context

Production uses S3 (presigned PUTs, SSE-KMS, CORS), SES v2, KMS and Secrets Manager. Mocks
in code drift from the real APIs; a real account costs money and needs credentials for
every contributor. The Terraform modules should be exercised before they reach an account.

## Decision

- `make up` starts Floci (an open-source AWS emulator, image `floci/floci:2.3.0`) on host
  port 4597, and a one-shot `terraform` container applies
  [`infra/terraform/envs/local-floci`](../../../infra/terraform/envs/local-floci/main.tf)
  against it with the same `kms`, `storage`, `secrets` and `email` modules production uses
  ([`deploy/compose/compose.floci.yaml`](../../../deploy/compose/compose.floci.yaml)).
- The API and worker run with `STORAGE=s3`, `MAIL_MODE=ses` and `AWS_ENDPOINT_URL` pointing
  at the emulator; presigned URLs use `S3_PUBLIC_ENDPOINT=http://localhost:4597` so the
  browser can reach them. Floci relays SES mail to Mailpit (UI on 8046).
- Redis stays a plain container: Floci serves ElastiCache data only with Docker socket
  access, which the stack does not grant.
- The integration matrix runs `STORAGE=s3` and `MAIL_MODE=ses` rows against the same
  emulator ([`scripts/test-matrix.sh`](../../../scripts/test-matrix.sh)).
- `make up-aws` is the escape hatch: local containers with real S3 and SES.

## Consequences

Positive:

- SDK calls, presigning, CORS and SES identity verification run for real, offline.
- The Terraform modules are applied on every local start.

Trade-offs:

- Emulator fidelity limits: the TLS-only bucket policy and versioning are off locally, IAM
  is not enforced.
- Emulator state lives in volumes; `make down` resets both together.
- One more image to keep pinned.

## Alternatives considered

- **Code-level mocks.** Fast, but they do not test presigning or CORS.
- **A real development account.** Accurate, costly; kept as `make up-aws`.
