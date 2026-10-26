/**
 * The /admin control plane's own facts: who the operator is (GET /admin/me), which
 * integrations this deployment has (GET /admin/integrations) and a live EVS check.
 *
 * Integration status never returns a key or a secret, only whether one is set and what
 * kind it looks like: "stub" when an API base points somewhere other than the real
 * gateway (the local stubs), "test" for test-mode keys, "live" otherwise, "off" when
 * the gateway is not configured at all.
 */
import type { AdminSession, IntegrationStatus } from "@open-lms/types";
import { aiAvailable, config, evsEnabled, razorpayEnabled, stripeEnabled, isRealKey } from "../core/config";
import { forbidden, HttpError } from "../core/errors";
import { requireActive, requireActor, requireArea, type Actor } from "../core/context";
import { isOperator, permissionsFor, seesAllCourses } from "../domain/admin-permissions";
import { evsCanList, listVideos } from "../integrations/evs";

const STRIPE_DEFAULT_BASE = "https://api.stripe.com";
const RAZORPAY_DEFAULT_BASE = "https://api.razorpay.com";

/** GET /admin/me: any operator (ACTIVE); learners get 403 FORBIDDEN_AREA. */
export function adminSession(actor: Actor | null): AdminSession {
  const a = requireActor(actor);
  if (!isOperator(a.role)) throw forbidden("You do not have access to the admin area", "FORBIDDEN_AREA");
  requireActive(a);
  return { role: a.role, permissions: permissionsFor(a.role), allCourses: seesAllCourses(a.role) };
}

type GatewayMode = IntegrationStatus["stripe"]["mode"];

/** Pure: how a gateway is set up, from its config values. Exported for the unit tests. */
export function gatewayMode(input: { enabled: boolean; apiBase: string; defaultBase: string; key: string | undefined; testPrefix: string }): GatewayMode {
  if (!input.enabled) return "off";
  if (input.apiBase.replace(/\/+$/, "") !== input.defaultBase) return "stub";
  return input.key?.trim().startsWith(input.testPrefix) ? "test" : "live";
}

function aiModel(provider: IntegrationStatus["ai"]["provider"]): string | null {
  if (provider === "openai") return config.OPENAI_MODEL;
  if (provider === "gemini") return config.GEMINI_MODEL;
  if (provider === "stub") return "stub";
  return null;
}

/** GET /admin/integrations (settings area). */
export function integrationStatus(actor: Actor): IntegrationStatus {
  requireArea(actor, "settings");
  const stripe = stripeEnabled();
  const razorpay = razorpayEnabled();
  const provider: IntegrationStatus["ai"]["provider"] = aiAvailable() ? config.AI_PROVIDER : "none";
  return {
    stripe: {
      configured: stripe,
      mode: gatewayMode({ enabled: stripe, apiBase: config.STRIPE_API_BASE, defaultBase: STRIPE_DEFAULT_BASE, key: config.STRIPE_SECRET_KEY, testPrefix: "sk_test_" }),
      webhookConfigured: isRealKey(config.STRIPE_WEBHOOK_SECRET),
    },
    razorpay: {
      configured: razorpay,
      mode: gatewayMode({ enabled: razorpay, apiBase: config.RAZORPAY_API_BASE, defaultBase: RAZORPAY_DEFAULT_BASE, key: config.RAZORPAY_KEY_ID, testPrefix: "rzp_test_" }),
      webhookConfigured: isRealKey(config.RAZORPAY_WEBHOOK_SECRET),
    },
    evs: { configured: evsEnabled(), baseUrl: config.EVS_BASE_URL ?? null, canListVideos: evsCanList() },
    ai: { provider, model: aiModel(provider) },
    mail: { mode: config.MAIL_MODE },
    storage: { mode: config.STORAGE },
  };
}

/**
 * POST /admin/integrations/evs/test: list one video with the read key, when there is
 * one. Without it only playback is configured, which is checked when a learner presses
 * play (minting a session needs a real video id). The answer never carries a key.
 */
export async function testEvs(actor: Actor): Promise<{ ok: boolean; message: string }> {
  requireArea(actor, "settings");
  if (!config.EVS_BASE_URL) return { ok: false, message: "EVS is not configured (set EVS_BASE_URL and EVS_PLAYBACK_KEY)." };
  if (!evsCanList()) {
    return evsEnabled()
      ? { ok: true, message: "Only playback is configured: set EVS_READ_KEY to test the connection and turn on the video picker." }
      : { ok: false, message: "EVS_BASE_URL is set but EVS_PLAYBACK_KEY is not: EVS lectures cannot play." };
  }
  try {
    const res = await listVideos({ limit: 1 });
    return { ok: true, message: `Connected to EVS: ${res.total} video${res.total === 1 ? "" : "s"} in the library.` };
  } catch (err) {
    return { ok: false, message: err instanceof HttpError ? err.message : "The video service did not answer" };
  }
}
