#!/usr/bin/env bash
# Make sure a disposable Postgres and Redis are reachable for the integration tests.
# Uses the compose services (started on their own if the stack is down); the suite
# creates and migrates its own *_test database and never touches `lms`.
#
# Host ports follow LMS_PG_PORT (5492) and LMS_REDIS_PORT (6429). When something
# already answers on both, nothing is started.
set -euo pipefail
cd "$(dirname "$0")/.."
pg_port="${LMS_PG_PORT:-5492}"
redis_port="${LMS_REDIS_PORT:-6429}"

listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

if listening "$pg_port" && listening "$redis_port"; then
  exit 0
fi
scripts/gen-local-env.sh >/dev/null # creates .env, or adds keys an older one lacks
docker compose --env-file deploy/compose/.env -f deploy/compose/compose.yaml up -d --wait postgres redis >/dev/null
