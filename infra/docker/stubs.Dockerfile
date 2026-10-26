# syntax=docker/dockerfile:1.7
# Local stand-ins for Stripe, Razorpay, the AI provider and the video service
# (apps/stubs). One dependency-free script plus a tiny HLS test stream, port 5119.
# Development and the test matrix only: production points at the real services.
#   docker build -f infra/docker/stubs.Dockerfile -t open-lms-stubs .
FROM node:22.23.4-alpine
ENV NODE_ENV=production PORT=5119
WORKDIR /app
COPY --chown=node:node apps/stubs/server.mjs apps/stubs/package.json ./
COPY --chown=node:node apps/stubs/assets/ ./assets/
USER node
EXPOSE 5119
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5119)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
