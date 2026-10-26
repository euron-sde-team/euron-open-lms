# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Web app (apps/web): Next.js standalone server on port 3000.
#   docker build -f infra/docker/web.Dockerfile -t open-lms-web .
#
# Requirements on apps/web/next.config: `output: "standalone"` and
# `outputFileTracingRoot` set to the repository root, so the server lands at
# apps/web/server.js inside the standalone tree.
#
# API_INTERNAL_URL is where the Next server proxies /api/* in local compose. Next
# evaluates rewrites at build time, so it is a build argument as well as runtime
# environment. On AWS the load balancer sends /api/* to the API before it reaches this
# server, so the value baked in here is never used there. MEDIA_ORIGINS and
# VIDEO_ORIGINS (the CSP's media and video sources) are runtime-only.
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG API_INTERNAL_URL=http://api:5026
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
# package.json too: it pins the pnpm version (packageManager) and carries the overrides
# the frozen lockfile is checked against.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter @open-lms/web...
RUN pnpm --filter @open-lms/web build && mkdir -p apps/web/public

FROM ${NODE_IMAGE} AS runtime
ARG API_INTERNAL_URL=http://api:5026
ENV NODE_ENV=production TZ=UTC PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 \
    API_INTERNAL_URL=${API_INTERNAL_URL}
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
# The standalone trace starts at the repo root, so the server lives at apps/web/server.js.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
