/**
 * The access token lives only in this module's memory: never localStorage or
 * sessionStorage, so an injected script cannot lift a long-lived credential.
 * Reloading the page re-establishes it from the httpOnly refresh cookie.
 */
import type { AuthResult, Me } from "@open-lms/types";

type Listener = () => void;

export interface SessionSnapshot {
  status: "loading" | "signed-in" | "signed-out";
  user: Me | null;
}

let accessToken: string | null = null;
let expiresAt = 0;
let snapshot: SessionSnapshot = { status: "loading", user: null };
const listeners = new Set<Listener>();
const tokenListeners = new Set<(token: string | null) => void>();

function emit() {
  for (const l of listeners) l();
  if (snapshot.status !== "loading") settle();
}

let settle: () => void = () => undefined;
/** Resolves once the boot refresh has settled (signed in or out); never rejects. */
const settled = new Promise<void>((resolve) => {
  settle = resolve;
});

export const session = {
  getToken: () => accessToken,
  /** Milliseconds since epoch at which the access token expires (0 when none). */
  getExpiresAt: () => expiresAt,
  getSnapshot: () => snapshot,
  /** Waits until the session is known, so requests do not go out as signed out by mistake. */
  ready: () => settled,
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** Called whenever the token value changes (the socket reconnects on it). */
  onToken(l: (token: string | null) => void) {
    tokenListeners.add(l);
    return () => {
      tokenListeners.delete(l);
    };
  },
  apply(result: AuthResult, now = Date.now()) {
    const changed = result.accessToken !== accessToken;
    accessToken = result.accessToken;
    expiresAt = now + result.expiresIn * 1000;
    snapshot = { status: "signed-in", user: result.user };
    emit();
    if (changed) for (const l of tokenListeners) l(accessToken);
  },
  setUser(user: Me) {
    if (snapshot.status !== "signed-in") return;
    snapshot = { status: "signed-in", user };
    emit();
  },
  clear() {
    const had = accessToken !== null;
    accessToken = null;
    expiresAt = 0;
    snapshot = { status: "signed-out", user: null };
    emit();
    if (had) for (const l of tokenListeners) l(null);
  },
};

/**
 * When to refresh: one minute before expiry, but never sooner than half the
 * lifetime (very short TTLs in tests), and never in the past.
 */
export function refreshDelay(expiresInSeconds: number): number {
  const lifetime = expiresInSeconds * 1000;
  const lead = Math.min(60_000, lifetime / 2);
  return Math.max(5_000, lifetime - lead);
}
