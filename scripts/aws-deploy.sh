#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-shot deployment to AWS:  scripts/aws-deploy.sh <aws-dev|aws-prod> <image-tag>
#
#   1. terraform apply the image registries (and the KMS key that encrypts them)
#   2. build the api and web images for $PLATFORM (linux/amd64 or linux/arm64), tag
#      them with the commit, push
#   3. terraform apply what the migrate task needs (network, database, task definition)
#   4. run the migrate task and wait for it (it must exit 0)
#   5. terraform apply everything else: cache, edge, the api, worker and web services
#   6. wait for the three services to become stable
#
# Then it prints the webhook URLs to register with Stripe, Razorpay and
# euron-video-system, and the secrets whose "set-me" placeholders still need real
# values (terraform output webhook_urls, payments_secret_name, evs_secret_name).
#
# Needs: terraform, docker (buildx), the AWS CLI, python3, credentials for the target
# account, and infra/terraform/envs/<env>/terraform.tfvars (copy the .example).
#
# PLATFORM (the image platform) defaults from cpu_architecture in terraform.tfvars and
# must agree with it, because a mismatch builds fine but the tasks die at start with
# "exec format error":
#   cpu_architecture = "X86_64" (default)  PLATFORM=linux/amd64
#   cpu_architecture = "ARM64" (Graviton)  PLATFORM=linux/arm64
# Building linux/arm64 on an x86 machine (or the reverse) needs QEMU binfmt for buildx.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ENV="${1:?usage: aws-deploy.sh <aws-dev|aws-prod> <image-tag>}"
TAG="${2:?usage: aws-deploy.sh <aws-dev|aws-prod> <image-tag>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/infra/terraform/envs/$ENV"
# Image platform: follows cpu_architecture in terraform.tfvars unless PLATFORM is set,
# and must agree with it.
arch=$(sed -nE 's/^cpu_architecture *= *"([^"]+)".*/\1/p' "$DIR/terraform.tfvars" 2>/dev/null || true)
want=$([[ "${arch:-X86_64}" == ARM64 ]] && echo linux/arm64 || echo linux/amd64)
PLATFORM="${PLATFORM:-$want}"
if [[ "$PLATFORM" != "$want" ]]; then
  echo "PLATFORM=$PLATFORM does not match cpu_architecture=${arch:-X86_64} in terraform.tfvars (needs $want)"
  exit 2
fi

for bin in terraform docker aws python3; do command -v "$bin" >/dev/null || { echo "missing: $bin"; exit 1; }; done
[[ -f "$DIR/terraform.tfvars" ]] || { echo "create $DIR/terraform.tfvars from terraform.tfvars.example first"; exit 1; }
if [[ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]]; then
  echo "note: the working tree has uncommitted changes; the images are built from it as-is"
fi

tf() { terraform -chdir="$DIR" "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

region="${AWS_REGION:-$(sed -nE 's/^region *= *"([^"]+)".*/\1/p' "$DIR/terraform.tfvars")}"
[[ -n "$region" ]] || { echo "set region in terraform.tfvars (or AWS_REGION)"; exit 1; }
export AWS_REGION="$region"

echo "==> terraform init"
tf init -input=false >/dev/null

echo "==> 1/6 registries"
tf apply -input=false -auto-approve -var "image_tag=$TAG" -target=module.lms.module.ecr

repos=$(tf output -json ecr_repositories)
api_repo=$(json "d['api']" <<<"$repos")
web_repo=$(json "d['web']" <<<"$repos")
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "${api_repo%%/*}" >/dev/null

echo "==> 2/6 images ($TAG, $PLATFORM)"
docker buildx build --platform "$PLATFORM" -f "$ROOT/infra/docker/api.Dockerfile" -t "$api_repo:$TAG" --push "$ROOT"
docker buildx build --platform "$PLATFORM" -f "$ROOT/infra/docker/web.Dockerfile" -t "$web_repo:$TAG" --push "$ROOT"

echo "==> 3/6 database and the migrate task"
tf apply -input=false -auto-approve -var "image_tag=$TAG" -target=module.lms.module.migrate

echo "==> 4/6 migrations"
"$ROOT/scripts/aws-run-task.sh" "$ENV" migrate

echo "==> 5/6 everything else"
tf apply -input=false -auto-approve -var "image_tag=$TAG"

echo "==> 6/6 waiting for the services"
cluster=$(tf output -raw cluster_name)
read -r -a services <<<"$(tf output -json services | json "' '.join(d.values())")"
aws ecs wait services-stable --region "$region" --cluster "$cluster" --services "${services[@]}"

url=$(tf output -raw app_url)
webhooks=$(tf output -json webhook_urls | json "'\\n'.join('  %-9s %s' % (k, v) for k, v in sorted(d.items()))")
pending=$(for o in payments_secret_name evs_secret_name; do tf output -json "$o" | json "d or ''"; done | sed '/^$/d; s/^/  /')
cat <<NEXT

Deployed $TAG to $ENV: $url

Webhook endpoints (register each one you use in that provider's dashboard):
$webhooks

Secrets created with "set-me" placeholders until you put real values (the API will not
sell through a gateway, or play EVS video, while its key is "set-me"):
${pending:-  (none: no payment gateway or EVS configured)}
  aws secretsmanager put-secret-value --secret-id <name> --secret-string '<full JSON object>'

Next, create the first administrator (emails a set-password link to that address;
the SES identity must be verified, and out of the SES sandbox or the address verified):
  make aws-admin ENV=$ENV EMAIL=you@example.com
NEXT
