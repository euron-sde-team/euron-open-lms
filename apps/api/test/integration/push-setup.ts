/**
 * Push test setup: the local stubs in-process on an ephemeral port standing in for FCM
 * (token endpoint and messages:send), and a throwaway service account. Import this
 * module FIRST: the API's config is read when the app module loads.
 */
import { generateKeyPairSync } from "node:crypto";
import { afterAll } from "vitest";
import { startStubs } from "../../../stubs/server.mjs";

export const stubs = await startStubs({});

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.PUSH_PROVIDER = "fcm";
process.env.FCM_BASE_URL = stubs.url;
process.env.FCM_TOKEN_URL = `${stubs.url}/fcm/token`;
process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "open-lms-test", client_email: "push@open-lms-test.example.test", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });

afterAll(async () => {
  await stubs.close();
});

/** Messages the fake FCM accepted for one device token. */
export function pushedTo(token: string) {
  return stubs.state.fcm.messages.filter((m) => (m.message as { token?: string }).token === token);
}
