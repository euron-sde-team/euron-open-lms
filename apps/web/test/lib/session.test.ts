import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "@open-lms/api-client";
import type { AuthResult } from "@open-lms/types";
import { refreshDelay, session } from "@/lib/session";
import { me } from "../fixtures";

const result = (token: string, expiresIn = 900): AuthResult => ({ accessToken: token, expiresIn, user: me });

afterEach(() => session.clear());

describe("in-memory session", () => {
  it("holds the token in memory only and notifies token listeners on change", () => {
    const seen: (string | null)[] = [];
    const off = session.onToken((t) => seen.push(t));
    session.apply(result("a"), 1_000);
    session.apply(result("a"), 2_000);
    session.apply(result("b"), 3_000);
    session.clear();
    off();
    expect(seen).toEqual(["a", "b", null]);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
  it("tracks status and expiry", () => {
    session.apply(result("a", 60), 10_000);
    expect(session.getSnapshot()).toMatchObject({ status: "signed-in", user: { id: "me" } });
    expect(session.getExpiresAt()).toBe(70_000);
    session.clear();
    expect(session.getSnapshot()).toEqual({ status: "signed-out", user: null });
    expect(session.getToken()).toBeNull();
  });
  it("ready() holds callers until the boot refresh settles, signed in or out", async () => {
    vi.resetModules();
    const { session: fresh } = await import("@/lib/session");
    let settled = false;
    void fresh.ready().then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    fresh.clear();
    await fresh.ready();
    expect(settled).toBe(true);
  });
  it("schedules the refresh a minute early, but not before half the lifetime or 5s", () => {
    expect(refreshDelay(900)).toBe(840_000);
    expect(refreshDelay(60)).toBe(30_000);
    expect(refreshDelay(4)).toBe(5_000);
  });
});

describe("refresh flow with the app session", () => {
  it("boots from the cookie, retries a stale call once, and signs out when refresh is refused", async () => {
    let refreshOk = true;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (url.endsWith("/auth/refresh")) {
        return refreshOk
          ? new Response(JSON.stringify(result(`t${fetchMock.mock.calls.length}`)), { status: 200, headers: { "content-type": "application/json" } })
          : new Response(JSON.stringify({ error: "Session expired", code: "SESSION_EXPIRED" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      if (auth === "Bearer stale") return new Response(JSON.stringify({ error: "x", code: "TOKEN_INVALID" }), { status: 401, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(me), { status: 200, headers: { "content-type": "application/json" } });
    });
    const onSignedOut = vi.fn(() => session.clear());
    const client = createApiClient({ baseUrl: "/api", getAccessToken: session.getToken, onRefresh: (r) => session.apply(r), onSignedOut, fetch: fetchMock as unknown as typeof fetch, crossTabLock: (fn) => fn() });

    await client.refreshSession();
    expect(session.getSnapshot().status).toBe("signed-in");

    session.apply(result("stale"));
    await expect(client.auth.me()).resolves.toMatchObject({ id: "me" });
    expect(session.getToken()).not.toBe("stale");
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).credentials !== "omit")).toBe(true);

    refreshOk = false;
    session.apply(result("stale"));
    await expect(client.auth.me()).rejects.toMatchObject({ code: "TOKEN_INVALID" });
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(session.getSnapshot().status).toBe("signed-out");
  });
});
