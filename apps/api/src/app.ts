/**
 * The Express application. Built by a factory so tests mount it in-process with
 * supertest and the server entry (index.ts) listens with it.
 */
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { allowedOrigins, config } from "./core/config";
import { HttpError } from "./core/errors";
import { newId } from "./core/ids";
import { captureError, logger } from "./core/logger";
import { db } from "./db/kysely";
import { redis } from "./integrations/redis";
import { mountRoutes, WEBHOOK_MOUNTS } from "./routes";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);

  app.use((req, res, next) => {
    const incoming = req.get("x-request-id");
    req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : newId();
    req.actor = null;
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).requestId,
      autoLogging: { ignore: (req) => req.url === "/up" || req.url === "/api/ready" },
      serializers: {
        req: (req: { method: string; url: string; id: string }) => ({ id: req.id, method: req.method, url: req.url.replace(/\/media\/local\/[^/?#]+/, "/media/local/[signed]") }),
      },
    }),
  );

  // The API serves JSON only; the web app sets its own CSP for pages.
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: "cross-origin" } }));

  const origins = allowedOrigins();
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.includes(origin)), credentials: true, maxAge: 600 }));

  // Cookie-authenticated endpoints (refresh, logout) reject cross-site callers even
  // though SameSite=Lax already covers top-level POSTs: defence in depth.
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" && !origins.includes(origin)) {
      res.status(403).json({ error: "Origin not allowed", code: "CORS_ORIGIN_DENIED", requestId: req.requestId });
      return;
    }
    next();
  });

  // Webhooks first, before the JSON parser: their signatures are computed over the
  // exact bytes received, so they get the raw body (req.body is a Buffer).
  for (const [prefix, router] of WEBHOOK_MOUNTS) app.use(prefix, express.raw({ type: () => true, limit: "1mb" }), router);

  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  /** Liveness: the process is up. */
  app.get("/up", (_req, res) => {
    res.json({ ok: true });
  });

  /** Readiness: Postgres and Redis answer. The load balancer health check. */
  app.get("/api/ready", async (_req, res) => {
    try {
      await db.selectNoFrom((eb) => eb.val(1).as("one")).execute();
      await redis().ping();
      res.json({ ok: true });
    } catch (err) {
      captureError(err, { where: "ready" });
      res.status(503).json({ ok: false });
    }
  });

  mountRoutes(app);

  app.use((req, res) => {
    res.status(404).json({ error: "Not found", code: "NOT_FOUND", requestId: req.requestId });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, code: err.code, ...(err.details !== undefined ? { details: err.details } : {}), requestId: req.requestId });
      return;
    }
    const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      // body-parser and friends: malformed JSON, payload too large.
      const type = (err as { type?: string }).type;
      res.status(status).json({ error: type === "entity.too.large" ? "Request body too large" : "Malformed request", code: type === "entity.too.large" ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST", requestId: req.requestId });
      return;
    }
    captureError(err, { requestId: req.requestId, method: req.method, url: req.originalUrl });
    res.status(500).json({ error: "Something went wrong", code: "INTERNAL", requestId: req.requestId });
  });

  return app;
}
