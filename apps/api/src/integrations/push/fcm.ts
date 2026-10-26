/**
 * Firebase Cloud Messaging HTTP v1, which delivers to Android directly and to iOS
 * through APNs (the APNs key is uploaded to the Firebase project, never to this server).
 *
 *   send   POST {FCM_BASE_URL}/v1/projects/{project}/messages:send
 *          Authorization: Bearer <OAuth2 access token>
 *   token  a JWT signed with the service account's private key (RS256, node:crypto),
 *          exchanged at the token endpoint for an access token, cached until a minute
 *          before it expires. No Google SDK.
 *
 * A token FCM reports as UNREGISTERED (404) or INVALID_ARGUMENT (400) is dead: the
 * caller deletes its device row. Anything else (429, 5xx, a network error) is a
 * transient failure for that message only.
 */
import { createSign } from "node:crypto";
import { HttpError } from "../../core/errors";
import type { PushMessage, PushProvider, PushResult } from "./provider";

const TIMEOUT_MS = 10_000;
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface FcmSettings {
  baseUrl: string;
  /** Overrides the service account's token_uri (the stubs stand in for Google here). */
  tokenUrl?: string;
  account: ServiceAccount;
}

/** Parse the service account JSON; null when it is missing, the placeholder, or lacks a field. */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim() || raw.trim() === "set-me") return null;
  try {
    const a = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof a.project_id !== "string" || typeof a.client_email !== "string" || typeof a.private_key !== "string") return null;
    return { project_id: a.project_id, client_email: a.client_email, private_key: a.private_key, ...(typeof a.token_uri === "string" ? { token_uri: a.token_uri } : {}) };
  } catch {
    return null;
  }
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** The signed assertion for the JWT bearer grant (RFC 7523). Exported for the unit tests. */
export function signAssertion(account: ServiceAccount, audience: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: audience, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}

/** The FCM `message` body for one device. Exported for the unit tests. */
export function fcmMessage(m: PushMessage): Record<string, unknown> {
  return {
    token: m.token,
    notification: { title: m.title, body: m.body },
    data: m.data,
    android: { priority: "high", notification: { channel_id: "default" } },
    apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } },
  };
}

/** Whether an FCM error response means the token is dead. Exported for the unit tests. */
export function isDeadToken(status: number, body: unknown): boolean {
  const err = (body as { error?: { status?: string; details?: { errorCode?: string }[] } } | null)?.error;
  const codes = [err?.status, ...(err?.details ?? []).map((d) => d.errorCode)];
  return codes.includes("UNREGISTERED") || codes.includes("INVALID_ARGUMENT") || (status === 404 && codes.includes("NOT_FOUND"));
}

export function fcmProvider(name: "fcm" | "stub", settings: () => FcmSettings | null): PushProvider {
  let cached: { token: string; until: number; key: string } | null = null;

  async function accessToken(s: FcmSettings): Promise<string> {
    const tokenUrl = s.tokenUrl ?? s.account.token_uri ?? DEFAULT_TOKEN_URL;
    const key = `${s.account.client_email}|${tokenUrl}`;
    if (cached && cached.key === key && cached.until > Date.now()) return cached.token;
    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signAssertion(s.account, tokenUrl) }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new HttpError(502, "The push token endpoint is not reachable", "PUSH_UNAVAILABLE");
    }
    const b = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !b.access_token) throw new HttpError(502, "The push token endpoint refused the service account", "PUSH_AUTH_FAILED");
    cached = { token: b.access_token, key, until: Date.now() + Math.max(60, (b.expires_in ?? 3600) - 60) * 1000 };
    return b.access_token;
  }

  return {
    name,
    async send(message: PushMessage): Promise<PushResult> {
      const s = settings();
      if (!s) return { ok: false, dead: false, error: "push is not configured" };
      const token = await accessToken(s);
      let res: Response;
      try {
        res = await fetch(`${s.baseUrl.replace(/\/+$/, "")}/v1/projects/${encodeURIComponent(s.account.project_id)}/messages:send`, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message: fcmMessage(message) }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        return { ok: false, dead: false, error: err instanceof Error ? err.message : String(err) };
      }
      const body = (await res.json().catch(() => null)) as { name?: string } | null;
      if (res.ok) return { ok: true, id: body?.name ?? null };
      // A rejected access token: forget it so the next message mints a new one.
      if (res.status === 401) cached = null;
      return { ok: false, dead: isDeadToken(res.status, body), error: `FCM answered ${res.status}` };
    },
  };
}
