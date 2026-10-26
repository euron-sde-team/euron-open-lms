/**
 * Which push provider runs (config.PUSH_PROVIDER), with a test override.
 *
 *   none  nothing is sent (the default); notify() does not even queue notify.push
 *   fcm   FCM HTTP v1 with FCM_SERVICE_ACCOUNT_JSON (fcm.ts)
 *   stub  the same client against apps/stubs (PUSH_STUB_URL), signed with a throwaway
 *         key generated at boot, so local runs exercise the real request path
 */
import { generateKeyPairSync } from "node:crypto";
import { config, pushEnabled } from "../../core/config";
import { fcmProvider, parseServiceAccount, type ServiceAccount } from "./fcm";
import type { PushProvider } from "./provider";

let stubAccount: ServiceAccount | null = null;
function stubServiceAccount(): ServiceAccount {
  if (!stubAccount) {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    stubAccount = { project_id: "open-lms-stub", client_email: "push@open-lms-stub.example.test", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
  }
  return stubAccount;
}

const fcm = fcmProvider("fcm", () => {
  const account = parseServiceAccount(config.FCM_SERVICE_ACCOUNT_JSON);
  return account ? { baseUrl: config.FCM_BASE_URL, ...(config.FCM_TOKEN_URL ? { tokenUrl: config.FCM_TOKEN_URL } : {}), account } : null;
});
const stub = fcmProvider("stub", () => {
  const base = config.PUSH_STUB_URL.replace(/\/+$/, "");
  return { baseUrl: base, tokenUrl: `${base}/fcm/token`, account: stubServiceAccount() };
});

let override: PushProvider | null = null;

/** Tests: force a provider (null restores normal selection). */
export function setPushProviderForTests(p: PushProvider | null): void {
  override = p;
}

/** The provider, or null when push is off. */
export function pushProvider(): PushProvider | null {
  if (override) return override;
  if (!pushEnabled()) return null;
  return config.PUSH_PROVIDER === "stub" ? stub : fcm;
}

export type { PushMessage, PushProvider, PushResult } from "./provider";
