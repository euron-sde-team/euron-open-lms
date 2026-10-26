#!/usr/bin/env bash
# Fail if the tree contains anything that must never be published: cloud
# credentials, private keys, real account ids or resource ids, real email
# addresses, public IP addresses, committed env files. Generic patterns only;
# runs in CI on every push.
#
#   scripts/check-sanitization.sh [dir]     (default: repo root)
set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || exit 2

EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo
  --exclude-dir=.terraform --exclude-dir=coverage --exclude-dir=samples --exclude=pnpm-lock.yaml
  --exclude=check-sanitization.sh --exclude=.gitleaks.toml --exclude=*.lock.hcl --exclude=*.tfstate*
  --exclude=*.png --exclude=*.jpg --exclude=*.webp --exclude=*.gif --exclude=*.mp4 --exclude=*.ico)

# Inside a git checkout, scan exactly the files git would commit (tracked plus
# untracked-but-not-ignored). That honors .gitignore by construction, so local
# state (deploy/compose/.env, terraform.tfstate, scratch dirs) is never in scope
# and nothing new slips past a hand-maintained exclude list. Outside git, fall
# back to a recursive grep with EXCLUDES.
FILES=()
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  while IFS= read -r -d '' f; do
    case "$f" in
      pnpm-lock.yaml | scripts/check-sanitization.sh | .gitleaks.toml | *.lock.hcl | \
        *.png | *.jpg | *.webp | *.gif | *.mp4 | *.ico) continue ;;
    esac
    [[ -f "$f" ]] && FILES+=("$f")
  done < <(git ls-files -z --cached --others --exclude-standard)
fi

failed=0
check() { # label, extended-regex, [allow-regex]
  local label="$1" pattern="$2" allow="${3:-}" hits
  if ((${#FILES[@]})); then
    hits="$(printf '%s\0' "${FILES[@]}" | xargs -0 grep -nIHE -- "$pattern" 2>/dev/null || true)"
  else
    hits="$(grep -rnIE "${EXCLUDES[@]}" -- "$pattern" . 2>/dev/null || true)"
  fi
  if [[ -n "$allow" && -n "$hits" ]]; then hits="$(grep -viE -- "$allow" <<<"$hits" || true)"; fi
  if [[ -n "$hits" ]]; then
    printf '\n\033[31m✗ %s\033[0m\n%s\n' "$label" "$(head -20 <<<"$hits")"
    failed=1
  fi
}

check "AWS access key id" '\b(AKIA|ASIA)[0-9A-Z]{16}\b'
check "Private key block" '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----' '\.example:|PRIVATE KEY-----\\n\.\.\.\\n'
# 000000000000 is the emulator's account and 123456789012 the documentation placeholder;
# UUIDs, hashes and lockfile integrity strings carry long digit runs legitimately.
check "12-digit number (possible AWS account id)" '(^|[^0-9.])[0-9]{12}([^0-9]|$)' '000000000000|123456789012|[0-9a-f]{8}-[0-9a-f]{4}|sha|integrity'
check "AWS resource id" '\b(ami|subnet|sg|vpc|pcx|rtb|igw|eni|vol|snap)-[0-9a-f]{8,17}\b' '-(0{8,17}|x+)\b'
check "RDS endpoint" '\.[a-z0-9]{12}\.[a-z0-9-]+\.rds\.amazonaws\.com'
check "Slack/GitHub/Stripe/OpenAI style token" '\b(xox[baprs]-[0-9A-Za-z-]{10,}|gh[pousr]_[0-9A-Za-z]{36}|sk_live_[0-9A-Za-z]{24,}|sk-(proj-)?[A-Za-z0-9_-]{32,})\b'
# Payment gateway credentials: Stripe live restricted keys, real-length Stripe webhook
# signing secrets and Razorpay live key ids. `make env` writes real-length random
# values only into the git-ignored deploy/compose/.env, which this scan never reads;
# fixtures in the tree (apps/stubs, tests) must stay short or visibly fake.
check "Stripe/Razorpay credential" '\b(rk_live_[0-9A-Za-z]{24,}|whsec_[0-9A-Za-z]{32,}|rzp_live_[0-9A-Za-z]{14})\b'
# Email addresses: only the reserved example domains and TLDs (.test, .example, .invalid:
# RFC 2606) and localhost. Real people's and companies' addresses never belong in the tree.
check "Email address outside the reserved example domains" \
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b' \
  '@([A-Za-z0-9-]+\.)*example\.(com|test|org|net)\b|@([A-Za-z0-9-]+\.)+(test|example|invalid)\b|@localhost\b|@users\.noreply\.github\.com\b'

# Public IPv4 addresses. Allowed: private (10/8, 172.16/12, 192.168/16), loopback,
# link-local, CGNAT, unspecified/broadcast, and the documentation ranges (RFC 5737).
ip_hits() {
  local raw
  if ((${#FILES[@]})); then
    raw="$(printf '%s\0' "${FILES[@]}" | xargs -0 grep -onIHE -- '(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)' 2>/dev/null || true)"
  else
    raw="$(grep -ronIE "${EXCLUDES[@]}" -- '(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)' . 2>/dev/null || true)"
  fi
  [[ -z "$raw" ]] && return 0
  awk '{
    line = $0
    if (match(line, /([0-9]{1,3}\.){3}[0-9]{1,3}/) == 0) next
    ip = substr(line, RSTART, RLENGTH)
    split(ip, o, ".")
    if (o[1] > 255 || o[2] > 255 || o[3] > 255 || o[4] > 255) next
    if (o[1] == 10 || o[1] == 127 || o[1] == 0 || o[1] == 255) next
    if (o[1] == 172 && o[2] >= 16 && o[2] <= 31) next
    if (o[1] == 192 && o[2] == 168) next
    if (o[1] == 169 && o[2] == 254) next
    if (o[1] == 100 && o[2] >= 64 && o[2] <= 127) next
    if (o[1] == 192 && o[2] == 0 && o[3] == 2) next
    if (o[1] == 198 && o[2] == 51 && o[3] == 100) next
    if (o[1] == 203 && o[2] == 0 && o[3] == 113) next
    print line
  }' <<<"$raw"
}
hits="$(ip_hits)"
if [[ -n "$hits" ]]; then
  printf '\n\033[31m✗ %s\033[0m\n%s\n' "Public IPv4 address" "$(head -20 <<<"$hits")"
  failed=1
fi

# Env files: only *.example may be tracked.
if git rev-parse --git-dir >/dev/null 2>&1; then
  tracked="$(git ls-files -- '*.env' '.env' '.env.*' '**/.env' '**/.env.*' | grep -v '\.example$' || true)"
  if [[ -n "$tracked" ]]; then
    printf '\n\033[31m✗ Committed env file(s)\033[0m\n%s\n' "$tracked"
    failed=1
  fi
fi

if [[ $failed -eq 0 ]]; then
  echo "sanitization: clean"
else
  echo; echo "sanitization: FAILED (see above). Replace real values with placeholders."
fi
exit $failed
