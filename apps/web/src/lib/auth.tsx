"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@open-lms/ui";
import type { AuthResult, Me } from "@open-lms/types";
import { api, onSessionEnded } from "./api";
import { isRestricted } from "./restriction";
import { refreshDelay, session, type SessionSnapshot } from "./session";
import { useDock } from "./stores/dock";

export type SecondFactor = string | { recoveryCode: string };

export type LoginOutcome = { ok: true; user: Me } | { ok: false; totpRequired: true };

interface AuthContextValue extends SessionSnapshot {
  isStaff: boolean;
  isAdmin: boolean;
  /** `second` is the authenticator code, or `{ recoveryCode }` when the user has lost the device. */
  login: (login: string, password: string, second?: SecondFactor) => Promise<LoginOutcome>;
  /** Apply an AuthResult from signup or verify-email. */
  acceptSession: (result: AuthResult) => void;
  logout: (opts?: { everywhere?: boolean; silent?: boolean }) => Promise<void>;
  reloadMe: () => Promise<void>;
  setUser: (user: Me) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const serverSnapshot: SessionSnapshot = { status: "loading", user: null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, () => serverSnapshot);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const closeDock = useDock((s) => s.closeAll);

  const wipe = useCallback(() => {
    queryClient.clear();
    closeDock();
  }, [queryClient, closeDock]);

  // Boot: the refresh cookie (if any) gives us an access token.
  useEffect(() => {
    let cancelled = false;
    api()
      .refreshSession()
      .then((r) => {
        if (!cancelled && !r) session.clear();
      })
      .catch(() => {
        // API unreachable or not ready: treat as signed out (pages show their signed-out state).
        if (!cancelled) session.clear();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The session ended underneath us (refresh rejected): back to sign-in.
  useEffect(
    () =>
      onSessionEnded(() => {
        wipe();
        toast.info({ title: "Your session ended", description: "Sign in again to continue." });
        const next = pathRef.current && pathRef.current !== "/login" ? `?next=${encodeURIComponent(pathRef.current)}` : "";
        router.replace(`/login${next}`);
      }),
    [router, wipe],
  );

  // Proactive refresh shortly before the access token expires.
  const expiresAt = session.getExpiresAt();
  useEffect(() => {
    if (snap.status !== "signed-in" || !expiresAt) return;
    const remainingSeconds = Math.max(0, (expiresAt - Date.now()) / 1000);
    const t = setTimeout(() => {
      api()
        .refreshSession()
        .then((r) => {
          if (!r) {
            session.clear();
            wipe();
          }
        })
        .catch(() => undefined);
    }, refreshDelay(remainingSeconds));
    return () => clearTimeout(t);
  }, [snap.status, expiresAt, wipe]);

  // Coming back to a tab after the token expired (timers are throttled in background tabs).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || session.getSnapshot().status !== "signed-in") return;
      if (session.getExpiresAt() - Date.now() < 60_000) void api().refreshSession().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const login = useCallback(async (loginId: string, password: string, second?: SecondFactor): Promise<LoginOutcome> => {
    const factor = typeof second === "string" ? (second ? { totp: second } : {}) : second?.recoveryCode ? { recoveryCode: second.recoveryCode } : {};
    const result = await api().auth.login({ login: loginId, password, ...factor });
    if ("totpRequired" in result) return { ok: false, totpRequired: true };
    session.apply(result);
    return { ok: true, user: result.user };
  }, []);

  const acceptSession = useCallback((result: AuthResult) => session.apply(result), []);

  const logout = useCallback(
    async (opts: { everywhere?: boolean; silent?: boolean } = {}) => {
      try {
        if (opts.everywhere) await api().auth.logoutAll();
        else await api().auth.logout();
      } catch {
        /* the cookie is cleared server-side when reachable; locally we sign out regardless */
      }
      session.clear();
      wipe();
      if (!opts.silent) router.push("/login");
    },
    [router, wipe],
  );

  const reloadMe = useCallback(async () => {
    const me = await api().auth.me();
    session.setUser(me);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...snap,
      isStaff: !!snap.user?.canOpenAdmin,
      isAdmin: snap.user?.role === "ADMIN",
      login,
      acceptSession,
      logout,
      reloadMe,
      setUser: session.setUser,
    }),
    [snap, login, acceptSession, logout, reloadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** True while the signed-in account is suspended: reading works, composing does not. */
export function useRestricted(): boolean {
  return isRestricted(useAuth().user);
}

/** The signed-in user, for components that only render behind RequireAuth. */
export function useMe(): Me {
  const { user } = useAuth();
  if (!user) throw new Error("useMe called while signed out");
  return user;
}
