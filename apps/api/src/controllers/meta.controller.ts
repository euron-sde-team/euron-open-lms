/** Public facts about the academy: what the web app needs before anyone signs in. */
import type { AcademyMeta } from "@open-lms/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { aiAvailable, config, razorpayEnabled, stripeEnabled } from "../core/config";
import { parse } from "../core/validate";
import { db } from "../db/kysely";
import { loadMedia, urlOf } from "../presenters/media.presenter";
import { atKey, decodeTime, encodeTime, olderThan, pageBy } from "../repositories/keyset";
import { academyName, getSettings } from "../services/settings.service";

export async function meta(_req: Request, res: Response) {
  const settings = await getSettings();
  const ai = aiAvailable();
  const [logo, plan] = await Promise.all([
    loadMedia([settings.logoUploadId]),
    db.selectFrom("plans").select("id").where("status", "=", "ACTIVE").executeTakeFirst(),
  ]);
  const currencies = [settings.currencies.default, ...settings.currencies.enabled.filter((c) => c !== settings.currencies.default)];
  const routing: Record<string, "STRIPE" | "RAZORPAY"> = {};
  for (const c of currencies) {
    const wanted = settings.gateways.routing[c] ?? settings.gateways.fallback;
    // A currency routed to a gateway that is not configured falls back to the other one.
    routing[c] = wanted === "RAZORPAY" && !razorpayEnabled() ? "STRIPE" : wanted === "STRIPE" && !stripeEnabled() ? "RAZORPAY" : wanted;
  }
  const body: AcademyMeta = {
    academyName: await academyName(),
    tagline: settings.tagline,
    logoUrl: urlOf(logo, settings.logoUploadId),
    registration: settings.registration,
    currencies,
    defaultCurrency: settings.currencies.default,
    payments: {
      stripe: { enabled: stripeEnabled(), publishableKey: stripeEnabled() ? (config.STRIPE_PUBLISHABLE_KEY ?? null) : null },
      razorpay: { enabled: razorpayEnabled(), keyId: razorpayEnabled() ? (config.RAZORPAY_KEY_ID ?? null) : null, checkoutScriptUrl: config.RAZORPAY_CHECKOUT_SCRIPT_URL },
      routing,
    },
    subscriptions: !!plan,
    ai: { quizGeneration: ai, gradingAssist: ai, polish: ai },
    support: { email: settings.supportEmail },
  };
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(body);
}

const sitemapQuery = z.object({ type: z.enum(["courses", "bundles", "instructors"]), cursor: z.string().max(200).optional() }).strict();
const SITEMAP_PAGE = 1000;

/**
 * GET /api/meta/sitemap?type=courses|bundles|instructors: public paths for the web
 * app's sitemap, newest change first, 1000 per keyset page. Only what a signed-out
 * visitor may open: published courses, active bundles, instructors listed on a
 * published course.
 */
export async function sitemap(req: Request, res: Response) {
  const q = parse(sitemapQuery, req.query);
  const cursor = decodeTime(q.cursor);
  let rows: { key: string; id: string; _at: string }[];
  if (q.type === "courses") {
    rows = await db
      .selectFrom("courses as c")
      .select(["c.slug as key", "c.id", atKey("c.updated_at")])
      .where("c.status", "=", "PUBLISHED")
      .where(olderThan("c.updated_at", "c.id", cursor))
      .orderBy("c.updated_at", "desc")
      .orderBy("c.id", "desc")
      .limit(SITEMAP_PAGE + 1)
      .execute();
  } else if (q.type === "bundles") {
    rows = await db
      .selectFrom("bundles as b")
      .select(["b.slug as key", "b.id", atKey("b.updated_at")])
      .where("b.status", "=", "ACTIVE")
      .where(olderThan("b.updated_at", "b.id", cursor))
      .orderBy("b.updated_at", "desc")
      .orderBy("b.id", "desc")
      .limit(SITEMAP_PAGE + 1)
      .execute();
  } else {
    rows = await db
      .selectFrom("users as u")
      .select(["u.username as key", "u.id", atKey("u.updated_at")])
      .where("u.status", "=", "ACTIVE")
      .where((eb) =>
        eb.exists(
          eb.selectFrom("course_staff as s").innerJoin("courses as c", "c.id", "s.course_id").select("s.user_id").whereRef("s.user_id", "=", "u.id").where("s.listed", "=", true).where("c.status", "=", "PUBLISHED"),
        ),
      )
      .where(olderThan("u.updated_at", "u.id", cursor))
      .orderBy("u.updated_at", "desc")
      .orderBy("u.id", "desc")
      .limit(SITEMAP_PAGE + 1)
      .execute();
  }
  const page = pageBy(rows, SITEMAP_PAGE, (r) => encodeTime(r._at, r.id));
  const prefix = q.type === "courses" ? "/courses/" : q.type === "bundles" ? "/bundles/" : "/instructors/";
  res.setHeader("Cache-Control", "public, max-age=600");
  res.json({ items: page.items.map((r) => ({ path: `${prefix}${encodeURIComponent(String(r.key))}`, updatedAt: r._at })), nextCursor: page.nextCursor });
}
