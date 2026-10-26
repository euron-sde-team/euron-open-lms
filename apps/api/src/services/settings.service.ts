/**
 * Academy settings: one JSON document in the `settings` table, merged over the defaults
 * below, cached for a few seconds per process. Admins edit it through
 * /api/admin/settings; every save is audited with the before and after values.
 */
import type { LmsSettings } from "@open-lms/types";
import { config } from "../core/config";
import { db, type Executor } from "../db/kysely";

export const DEFAULT_SETTINGS: LmsSettings = {
  academyName: config.PRODUCT_NAME,
  tagline: "Learn by doing, at your own pace.",
  logoUploadId: null,
  registration: "OPEN",
  supportEmail: null,
  currencies: { enabled: ["USD"], default: "USD" },
  gateways: { routing: { INR: "RAZORPAY" }, fallback: "STRIPE" },
  tax: { enabled: false, mode: "EXCLUSIVE", rules: [] },
  seller: { legalName: config.PRODUCT_NAME, address: "", taxId: null, email: null },
  learning: { videoCompletePercent: 90, reviewMinProgressPercent: 20, subscriptionGraceDays: 3, orderTtlMinutes: 60 },
  certificates: { signatoryName: "", signatoryTitle: "", footer: "" },
  analytics: { timezone: "UTC" },
};

const TTL_MS = 5_000;
let cache: { at: number; value: LmsSettings } | null = null;

/** Every group is merged key by key, so a stored document from an older release keeps working. */
export function mergeSettings(base: LmsSettings, stored: Partial<LmsSettings>): LmsSettings {
  return {
    ...base,
    ...stored,
    currencies: { ...base.currencies, ...(stored.currencies ?? {}) },
    gateways: { ...base.gateways, ...(stored.gateways ?? {}), routing: { ...(stored.gateways?.routing ?? base.gateways.routing) } },
    tax: { ...base.tax, ...(stored.tax ?? {}) },
    seller: { ...base.seller, ...(stored.seller ?? {}) },
    learning: { ...base.learning, ...(stored.learning ?? {}) },
    certificates: { ...base.certificates, ...(stored.certificates ?? {}) },
    analytics: { ...base.analytics, ...(stored.analytics ?? {}) },
  };
}

export async function getSettings(exec: Executor = db): Promise<LmsSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await exec.selectFrom("settings").select("value").where("key", "=", "academy").executeTakeFirst();
  const value = mergeSettings(DEFAULT_SETTINGS, (row?.value as Partial<LmsSettings>) ?? {});
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(patch: Partial<LmsSettings>, actorId: string | null, exec: Executor = db): Promise<{ before: LmsSettings; after: LmsSettings }> {
  const before = await getSettings(exec);
  const after = mergeSettings(before, patch);
  await exec
    .insertInto("settings")
    .values({ key: "academy", value: JSON.stringify(after), updated_by: actorId })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: JSON.stringify(after), updated_by: actorId, updated_at: new Date() }))
    .execute();
  cache = null;
  return { before, after };
}

export function clearSettingsCache(): void {
  cache = null;
}

/** The name to show for this academy (emails, page titles, certificates). */
export async function academyName(exec: Executor = db): Promise<string> {
  return (await getSettings(exec)).academyName?.trim() || config.PRODUCT_NAME;
}
