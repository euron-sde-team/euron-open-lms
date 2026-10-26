# Euron Open LMS: developer entry points. `make` lists every target.
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

COMPOSE_DIR := deploy/compose
FLOCI       := docker compose --env-file $(COMPOSE_DIR)/.env -f $(COMPOSE_DIR)/compose.yaml -f $(COMPOSE_DIR)/compose.floci.yaml
AWS_LOCAL   := docker compose --env-file $(COMPOSE_DIR)/.env --env-file $(COMPOSE_DIR)/.env.aws -f $(COMPOSE_DIR)/compose.yaml -f $(COMPOSE_DIR)/compose.aws.yaml
TF_IMAGE    := hashicorp/terraform:1.16.6
TFLINT      := docker run --rm -v $(CURDIR)/infra/terraform:/data -v open-lms-tflint:/plugins -e TFLINT_PLUGIN_DIR=/plugins -w /data ghcr.io/terraform-linters/tflint:v0.64.0
TF_ENVS     := local-floci aws-dev aws-prod
# Use a local terraform when installed, otherwise the pinned container.
TF          := $(shell command -v terraform >/dev/null 2>&1 && echo terraform || echo docker run --rm -v $(CURDIR)/infra/terraform:/infra -w /infra $(TF_IMAGE))
TF_ROOT     := $(shell command -v terraform >/dev/null 2>&1 && echo infra/terraform || echo /infra)
ENV         ?= aws-dev
TAG         ?= $(shell git rev-parse --short=12 HEAD 2>/dev/null || echo dev)
PG_PORT     := $${LMS_PG_PORT:-5492}
REDIS_PORT  := $${LMS_REDIS_PORT:-6429}
TEST_DB     ?= postgres://lms:lms@localhost:$(PG_PORT)/lms_test
TEST_REDIS  ?= redis://localhost:$(REDIS_PORT)/1

.PHONY: help env up up-aws down logs ps demo admin test test-integration test-matrix e2e lint typecheck build openapi \
        sanitize tf-fmt tf-validate tf-lint tf-security aws-plan aws-deploy aws-migrate aws-admin clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n\n"} /^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ─── Local ───────────────────────────────────────────────────────────────────

env: ## Generate deploy/compose/.env with random local-only secrets
	@scripts/gen-local-env.sh

up: env ## Start everything on emulated AWS (Floci), provisioned by the same Terraform as production
	$(FLOCI) up -d --build --wait
	@echo ""
	@echo "  app      http://localhost:$${LMS_WEB_PORT:-3530}"
	@echo "  api      http://localhost:$${LMS_API_PORT:-5026}/api/ready"
	@echo "  mail     http://localhost:$${LMS_MAILPIT_PORT:-8046}"
	@echo "  s3/ses   http://localhost:$${LMS_FLOCI_PORT:-4597}  (Floci)"
	@echo "  stubs    http://localhost:$${LMS_STUB_PORT:-5119}  (Stripe, Razorpay, AI and video stand-ins)"
	@echo ""
	@echo "  Next: make demo   (a demo academy: courses, learners, orders and certificates)"

up-aws: env ## Start the stack against real AWS resources (needs deploy/compose/.env.aws)
	@test -f $(COMPOSE_DIR)/.env.aws || { echo "copy $(COMPOSE_DIR)/.env.aws.example to .env.aws first"; exit 1; }
	$(AWS_LOCAL) up -d --build --wait

down: ## Stop the stack and delete its volumes
	-$(FLOCI) down -v --remove-orphans
	-$(AWS_LOCAL) down -v --remove-orphans 2>/dev/null

logs: ## Tail logs (SERVICE=api|worker|web|stubs|migrate|floci|terraform|...)
	$(FLOCI) logs -f --tail 100 $(SERVICE)

ps: ## Show stack status
	$(FLOCI) ps -a

demo: ## Seed the demo academy: courses, instructors, learners, orders, reviews (prints the logins)
	@pw=$$(grep '^LMS_DEMO_PASSWORD=' $(COMPOSE_DIR)/.env | cut -d= -f2-); \
	$(FLOCI) exec -T -e DEMO_PASSWORD="$$pw" api node dist/cli.js demo:seed && \
	echo "" && echo "  Every demo account signs in with the password: $$pw" && \
	echo "  (LMS_DEMO_PASSWORD in $(COMPOSE_DIR)/.env)"

admin: ## Create or promote an administrator on the local stack (EMAIL=you@example.com)
	@test -n "$(EMAIL)" || { echo "usage: make admin EMAIL=you@example.com"; exit 1; }
	$(FLOCI) exec -T api node dist/cli.js admin:create --email "$(EMAIL)"

# ─── Quality ─────────────────────────────────────────────────────────────────

lint: ## Lint every package
	pnpm lint

typecheck: ## Typecheck every package
	pnpm typecheck

test: ## Unit tests (every package)
	pnpm test

test-integration: ## API integration tests against Postgres + Redis from compose (started if needed)
	@scripts/test-db.sh
	TEST_DATABASE_URL=$(TEST_DB) TEST_REDIS_URL=$(TEST_REDIS) pnpm test:integration

test-matrix: ## Integration tests under every backend: storage x mail x AI provider (12 runs, on Floci)
	@scripts/test-matrix.sh

e2e: up demo ## Browser end-to-end tests (Playwright) against the running Floci stack
	pnpm e2e

build: ## Build every package
	pnpm build

openapi: ## Regenerate docs/api/openapi.yaml from the route files
	pnpm openapi

sanitize: ## Scan committable files for credentials, account ids, real emails and IPs
	@scripts/check-sanitization.sh

# ─── Terraform ───────────────────────────────────────────────────────────────

tf-fmt: ## Format all Terraform (CHECK=1: only check)
	$(TF) fmt -recursive $(if $(CHECK),-check -diff,) $(TF_ROOT)

tf-validate: ## terraform fmt -check, then validate every environment (no backend, no credentials)
	$(TF) fmt -recursive -check $(TF_ROOT)
	@for env in $(TF_ENVS); do \
	  echo "== $$env"; \
	  $(TF) -chdir=$(TF_ROOT)/envs/$$env init -backend=false -input=false -no-color >/dev/null && \
	  $(TF) -chdir=$(TF_ROOT)/envs/$$env validate -no-color || exit 1; \
	done

tf-lint: ## tflint every module and environment (plugins cached in a docker volume)
	$(TFLINT) --init
	$(TFLINT) --recursive --format compact

tf-security: ## checkov policy scan of the Terraform (any unskipped finding fails)
	docker run --rm -v $(CURDIR)/infra/terraform:/tf bridgecrew/checkov:3.3.30 -d /tf --config-file /tf/.checkov.yaml --framework terraform --quiet --compact

# ─── AWS ─────────────────────────────────────────────────────────────────────

aws-plan: ## terraform plan for ENV (aws-dev | aws-prod); needs terraform.tfvars and AWS credentials
	terraform -chdir=infra/terraform/envs/$(ENV) init -input=false
	terraform -chdir=infra/terraform/envs/$(ENV) plan -var image_tag=$(TAG)

aws-deploy: ## One shot: registries, images, infrastructure, migrations, rollout (ENV=aws-dev|aws-prod)
	@scripts/aws-deploy.sh $(ENV) $(TAG)

aws-migrate: ## Run database migrations as a one-off ECS task (ENV=...)
	@scripts/aws-run-task.sh $(ENV) migrate

aws-admin: ## Create the first administrator as a one-off ECS task; emails a set-password link (ENV=... EMAIL=you@example.com)
	@test -n "$(EMAIL)" || { echo "usage: make aws-admin EMAIL=you@example.com"; exit 1; }
	@scripts/aws-run-task.sh $(ENV) admin --email "$(EMAIL)"

clean: ## Remove build output
	rm -rf apps/*/dist apps/*/.next packages/*/dist .turbo e2e/.report e2e/.results
