/**
 * /api/admin operations (admin.routes.ts): the operator session, the overview and its
 * CSV, settings and integrations, the audit trail and certificates. Thin: parse with
 * strict zod schemas, call the service (which checks the area), respond. The learners
 * console is admin-learners.controller.ts, staff roles staff.controller.ts.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, pageQuery, parse, text } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as admin from "../services/admin.service";
import * as certificates from "../services/admin-certificates.service";
import { isCurrencyCode, isTimeZone, readSettings, updateSettings } from "../services/admin-settings.service";
import * as overview from "../services/admin-stats.service";
import { listAudit } from "../services/audit.service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const rangeQuery = z.object({ from: day.optional(), to: day.optional() }).strict();

export async function me(req: Request, res: Response) {
  res.json(admin.adminSession(req.actor));
}

export async function stats(req: Request, res: Response) {
  res.json(await overview.stats(actorOf(req), parse(rangeQuery, req.query)));
}

export async function statsCsv(req: Request, res: Response) {
  await overview.streamStatsCsv(actorOf(req), parse(rangeQuery, req.query), res);
}

// ─── Settings ───────────────────────────────────────────────────────────────

const currency = z.string().refine(isCurrencyCode, "must be an ISO 4217 currency code (3 capital letters)");
const gatewayName = z.enum(["STRIPE", "RAZORPAY"]);
const percent = z.number().int().min(1).max(100);
const email = z.string().trim().email().max(200);

/** Every group is strict: an unknown key anywhere is a 400. */
export const settingsPatch = z
  .object({
    academyName: text(80, 1),
    tagline: z.string().trim().max(160),
    logoUploadId: id().nullable(),
    registration: z.enum(["OPEN", "CLOSED"]),
    supportEmail: email.nullable(),
    currencies: z
      .object({
        enabled: z
          .array(currency)
          .min(1)
          .max(20)
          .refine((l) => new Set(l).size === l.length, "must not repeat a currency"),
        default: currency,
      })
      .partial()
      .strict(),
    gateways: z
      .object({
        routing: z.record(currency, gatewayName).refine((r) => Object.keys(r).length <= 50, "at most 50 currencies"),
        fallback: gatewayName,
      })
      .partial()
      .strict(),
    tax: z
      .object({
        enabled: z.boolean(),
        mode: z.enum(["EXCLUSIVE", "INCLUSIVE"]),
        rules: z
          .array(
            z
              .object({
                country: z.string().regex(/^(\*|[A-Z]{2})$/, 'must be "*" or a 2-letter country code'),
                rateBps: z.number().int().min(0).max(10_000),
                label: text(40, 1),
              })
              .strict(),
          )
          .max(250),
      })
      .partial()
      .strict(),
    seller: z
      .object({ legalName: text(200, 1), address: z.string().trim().max(500), taxId: z.string().trim().max(60).nullable(), email: email.nullable() })
      .partial()
      .strict(),
    learning: z
      .object({
        videoCompletePercent: percent,
        reviewMinProgressPercent: percent,
        subscriptionGraceDays: z.number().int().min(0).max(30),
        orderTtlMinutes: z.number().int().min(5).max(1440),
        offline: z
          .object({ enabled: z.boolean(), days: z.number().int().min(1).max(365), maxPerUser: z.number().int().min(1).max(500) })
          .partial()
          .strict(),
      })
      .partial()
      .strict(),
    certificates: z
      .object({ signatoryName: z.string().trim().max(80), signatoryTitle: z.string().trim().max(80), footer: z.string().trim().max(300) })
      .partial()
      .strict(),
    analytics: z
      .object({ timezone: z.string().refine(isTimeZone, "must be an IANA time zone, for example Europe/Berlin") })
      .partial()
      .strict(),
    mobile: z
      .object({
        iosWebPurchaseLink: z.boolean(),
        minSupportedVersion: z
          .string()
          .trim()
          .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/, "must be a version like 1.4.0")
          .nullable(),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

export async function getSettings(req: Request, res: Response) {
  res.json(await readSettings(actorOf(req)));
}

export async function patchSettings(req: Request, res: Response) {
  res.json(await updateSettings(actorOf(req), parse(settingsPatch, req.body), meta(req)));
}

export async function integrations(req: Request, res: Response) {
  res.json(admin.integrationStatus(actorOf(req)));
}

export async function testEvs(req: Request, res: Response) {
  res.json(await admin.testEvs(actorOf(req)));
}

// ─── Audit ──────────────────────────────────────────────────────────────────

const auditQuery = pageQuery
  .extend({ action: z.string().trim().min(1).max(80).optional(), actorId: id().optional(), entityType: z.string().trim().min(1).max(40).optional(), entityId: z.string().trim().min(1).max(80).optional() })
  .strict();

export async function audit(req: Request, res: Response) {
  const q = parse(auditQuery, req.query);
  res.json(await listAudit(actorOf(req), { ...q, limit: q.limit ?? 20 }));
}

// ─── Certificates ───────────────────────────────────────────────────────────

const reasonBody = z.object({ reason: text(300, 3) }).strict();

export async function listCertificates(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ q: z.string().trim().max(120).optional() }).strict(), req.query);
  res.json(await certificates.listCertificates(actorOf(req), { ...q, limit: q.limit ?? 20 }));
}

export async function revokeCertificate(req: Request, res: Response) {
  const { reason } = parse(reasonBody, req.body);
  res.json(await certificates.revokeCertificate(actorOf(req), parse(idParam, req.params).id, reason, meta(req)));
}

export async function restoreCertificate(req: Request, res: Response) {
  parse(z.object({}).strict(), req.body);
  res.json(await certificates.restoreCertificate(actorOf(req), parse(idParam, req.params).id, meta(req)));
}
