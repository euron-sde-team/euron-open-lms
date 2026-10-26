import { createApiClient } from "@open-lms/api-client";
import { runtimeEnv } from "./runtime-env";
import { session } from "./session";

let signedOutHandler: (() => void) | null = null;

/** Registered by the auth provider: what to do when the session ends underneath us. */
export function onSessionEnded(fn: () => void) {
  signedOutHandler = fn;
  return () => {
    if (signedOutHandler === fn) signedOutHandler = null;
  };
}

function build() {
  const env = runtimeEnv();
  return createApiClient({
    baseUrl: env.apiUrl,
    getAccessToken: session.getToken,
    ready: session.ready,
    onRefresh: (result) => session.apply(result),
    onSignedOut: () => {
      session.clear();
      signedOutHandler?.();
    },
  });
}

type Client = ReturnType<typeof build>;
let client: Client | null = null;

/** The app-wide API client (lazy, so it reads /env.js after it loaded). */
export function api(): Client {
  if (!client) client = build();
  return client;
}
