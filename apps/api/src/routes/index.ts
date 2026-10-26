/**
 * Every router and where it is mounted. scripts/gen-openapi.ts reads this file, so keep
 * one `[prefix, router]` entry per line. Webhook routers are mounted separately in
 * app.ts (WEBHOOK_MOUNTS) because they need the raw request body for signatures.
 */
import type { Express } from "express";
import { router as adminCatalog } from "./admin-catalog.routes";
import { router as adminCommerce } from "./admin-commerce.routes";
import { router as adminCourses } from "./admin-courses.routes";
import { router as adminEvs } from "./admin-evs.routes";
import { router as adminGrading } from "./admin-grading.routes";
import { router as adminModeration } from "./admin-moderation.routes";
import { router as admin } from "./admin.routes";
import { router as assessments } from "./assessments.routes";
import { router as auth } from "./auth.routes";
import { router as billing } from "./billing.routes";
import { router as catalog } from "./catalog.routes";
import { router as certificates } from "./certificates.routes";
import { router as checkout } from "./checkout.routes";
import { router as community } from "./community.routes";
import { router as evsWebhook } from "./evs-webhook.routes";
import { router as learn } from "./learn.routes";
import { router as media } from "./media.routes";
import { router as meta } from "./meta.routes";
import { router as my } from "./my.routes";
import { router as notifications } from "./notifications.routes";
import { router as users } from "./users.routes";
import { router as webhooks } from "./webhooks.routes";

export const MOUNTS = [
  ["/api/auth", auth],
  ["/api/users", users],
  ["/api/meta", meta],
  ["/api/media", media],
  ["/api/notifications", notifications],
  ["/api/catalog", catalog],
  ["/api/learn", learn],
  ["/api/my", my],
  ["/api/certificates", certificates],
  ["/api/assessments", assessments],
  ["/api/community", community],
  ["/api/checkout", checkout],
  ["/api/billing", billing],
  ["/api/admin/courses", adminCourses],
  ["/api/admin/catalog", adminCatalog],
  ["/api/admin/evs", adminEvs],
  ["/api/admin/grading", adminGrading],
  ["/api/admin/moderation", adminModeration],
  ["/api/admin/commerce", adminCommerce],
  ["/api/admin", admin],
] as const;

/** Gateway and EVS webhooks: raw bodies, no auth, signature-verified inside. */
export const WEBHOOK_MOUNTS = [
  ["/api/webhooks/evs", evsWebhook],
  ["/api/webhooks", webhooks],
] as const;

export function mountRoutes(app: Express): void {
  for (const [prefix, router] of MOUNTS) app.use(prefix, router);
}
