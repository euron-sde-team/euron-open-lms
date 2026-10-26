/**
 * Editing the academy settings (GET/PATCH /api/admin/settings, ADMIN only). The
 * controller's zod schema checks each group's shape; this service checks what only the
 * merged document can tell (the default currency must be enabled), claims a new logo
 * upload, saves through settings.service.ts saveSettings and audits `settings.update`
 * with the changed top-level keys and their before and after values, in one transaction.
 *
 * Patches merge group by group (settings.service.ts mergeSettings, `learning.offline` one
 * level deeper): a group's omitted fields keep their values, while lists (`currencies.enabled`, `tax.rules`) and the
 * `gateways.routing` map are replaced as a whole.
 */
import type { LmsSettings } from "@open-lms/types";
import { requireArea, type Actor, type RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest } from "../core/errors";
import { audit } from "./audit.service";
import { claimSingle } from "./media-attach.service";
import { clearSettingsCache, getSettings, mergeSettings, saveSettings } from "./settings.service";

type Learning = LmsSettings["learning"];
export type SettingsPatch = { [K in Exclude<keyof LmsSettings, "learning">]?: LmsSettings[K] extends Record<string, unknown> ? Partial<LmsSettings[K]> : LmsSettings[K] } & {
  learning?: Partial<Omit<Learning, "offline">> & { offline?: Partial<Learning["offline"]> };
};

/** An IANA time zone the runtime knows ("Asia/Kolkata", "UTC"). */
export function isTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

let currencyList: Set<string> | null = null;
/** An ISO 4217 code the runtime knows ("USD", "INR"). */
export function isCurrencyCode(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  currencyList ??= new Set(Intl.supportedValuesOf("currency"));
  return currencyList.has(code);
}

export async function readSettings(actor: Actor): Promise<LmsSettings> {
  requireArea(actor, "settings");
  return getSettings();
}

/** Problems only the merged document shows. Pure, exported for the unit tests. */
export function settingsProblems(s: LmsSettings): string[] {
  const out: string[] = [];
  if (!s.currencies.enabled.includes(s.currencies.default)) out.push("currencies.default must be one of currencies.enabled");
  const countries = s.tax.rules.map((r) => r.country);
  if (new Set(countries).size !== countries.length) out.push("tax.rules has the same country twice");
  return out;
}

export async function updateSettings(actor: Actor, patch: SettingsPatch, meta: RequestMeta): Promise<LmsSettings> {
  requireArea(actor, "settings");
  return withTransaction(async (trx) => {
    const input = { ...patch } as Partial<LmsSettings>;
    if (patch.logoUploadId !== undefined) input.logoUploadId = await claimSingle(actor.id, patch.logoUploadId, "BRANDING", trx);
    clearSettingsCache();
    const current = await getSettings(trx);
    const problems = settingsProblems(mergeSettings(current, input));
    if (problems.length) throw badRequest(problems[0]!, "SETTINGS_INVALID", { problems });
    const { before, after } = await saveSettings(input, actor.id, trx);
    const b = before as unknown as Record<string, unknown>;
    const a = after as unknown as Record<string, unknown>;
    const keys = Object.keys(input).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    if (keys.length) {
      await audit(
        { actorId: actor.id, action: "settings.update", entityType: "settings", entityId: "academy", ip: meta.ip, data: { keys, before: Object.fromEntries(keys.map((k) => [k, b[k]])), after: Object.fromEntries(keys.map((k) => [k, a[k]])) } },
        trx,
      );
    }
    // A rolled-back save must not leave the new value cached.
    clearSettingsCache();
    return after;
  });
}
