# Full CI pipeline (opt-in)

These workflows are the complete quality pipeline for Euron Open LMS. They are kept
here, outside `.github/workflows/`, so they do **not** run on the upstream repository.
Only the fast [`checks`](../workflows/checks.yml) workflow (lint, typecheck, unit tests,
Terraform fmt and validate, the OpenAPI check, the sanitization scan) runs there.

| Workflow | What it runs |
| --- | --- |
| [`ci.yml`](ci.yml) | Lint, typecheck, unit tests, build, then the API integration tests on Postgres 16 and Redis 7 service containers |
| [`security.yml`](security.yml) | gitleaks (full history), CodeQL (JavaScript/TypeScript), `pnpm audit` |
| [`terraform.yml`](terraform.yml) | `terraform fmt` and `validate` for every environment, tflint, checkov |
| [`docker.yml`](docker.yml) | Multi-arch builds of the api, web and stubs images (pushed to GHCR on tags; stubs is the local Stripe, Razorpay, OpenAI and EVS stand-in) |
| [`e2e.yml`](e2e.yml) | The full stack on the local AWS emulator with the stubs (`make up`, `make demo`): the integration suite under every storage, mail and AI backend, then the browser tests (`pnpm e2e`) |

To enable them in your fork, move them into `.github/workflows/`:

```bash
git mv .github/workflows-full/*.yml .github/workflows/
```

Every gate is also runnable locally:
`make lint typecheck test test-integration test-matrix e2e tf-validate tf-lint tf-security sanitize`.
