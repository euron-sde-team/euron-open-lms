/** Auth, the academy meta, your account, uploads and notifications. */
import type { AcademyMeta, AuthResult, EmailCategory, Me, Media, Notification, NotificationCounts, Page } from "@open-lms/types";
import { uploadMedia, type UploadOptions } from "../upload";
import { enc, type Helpers, type PageQuery } from "./helpers";

export interface SignupInput {
  email: string;
  username: string;
  displayName: string;
  password: string;
}

export interface LoginInput {
  login: string;
  password: string;
  totp?: string;
  /** A one-time recovery code, sent instead of `totp`. */
  recoveryCode?: string;
}

export type SignupResult = AuthResult | { verificationRequired: true; email: string };
export type LoginResult = AuthResult | { totpRequired: true };

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

export interface AccountPatch {
  displayName?: string;
  certificateName?: string | null;
  headline?: string | null;
  bio?: string | null;
  website?: string | null;
  avatarUploadId?: string | null;
  preferredCurrency?: string | null;
  emailPreferences?: Partial<Record<EmailCategory, boolean>>;
}

export function coreEndpoints(h: Helpers) {
  const { http, get, post, patch, del, pq, download } = h;

  const auth = {
    signup: (body: SignupInput) => http.request<SignupResult>("POST", "/auth/signup", { body, withCredentials: true, noRefresh: true }),
    verifyEmail: (token: string) => http.request<AuthResult>("POST", "/auth/verify-email", { body: { token }, withCredentials: true, noRefresh: true }),
    resendVerification: (email: string) => http.request<void>("POST", "/auth/resend-verification", { body: { email }, noRefresh: true }),
    login: (body: LoginInput) => http.request<LoginResult>("POST", "/auth/login", { body, withCredentials: true, noRefresh: true }),
    refresh: () => http.refreshSession(),
    logout: () => http.request<void>("POST", "/auth/logout", { withCredentials: true, noRefresh: true }),
    logoutAll: () => http.request<void>("POST", "/auth/logout-all", { withCredentials: true }),
    forgotPassword: (email: string) => http.request<void>("POST", "/auth/forgot-password", { body: { email }, noRefresh: true }),
    resetPassword: (token: string, password: string) => http.request<void>("POST", "/auth/reset-password", { body: { token, password }, noRefresh: true }),
    changePassword: (currentPassword: string, newPassword: string) => http.request<void>("POST", "/auth/change-password", { body: { currentPassword, newPassword }, withCredentials: true }),
    me: (signal?: AbortSignal) => get<Me>("/auth/me", undefined, signal),
    totpSetup: () => post<{ secret: string; otpauthUrl: string }>("/auth/totp/setup"),
    /** Turns two-factor on and returns the one-time recovery codes (shown once). */
    totpEnable: (code: string) => post<{ recoveryCodes: string[] }>("/auth/totp/enable", { code }),
    totpDisable: (password: string, code: string) => post("/auth/totp/disable", { password, code }),
    /** Replaces every recovery code with a fresh set. */
    totpRecoveryCodes: (password: string, code: string) => post<{ recoveryCodes: string[] }>("/auth/totp/recovery-codes", { password, code }),
  };

  const meta = {
    get: (signal?: AbortSignal) => http.request<AcademyMeta>("GET", "/meta", { signal, noRefresh: true }),
  };

  const users = {
    me: () => get<Me>("/users/me"),
    updateMe: (body: AccountPatch) => patch<Me>("/users/me", body),
    /** Asks for deletion: signed out everywhere, erased after the grace period. 409 SUBSCRIPTION_ACTIVE, LAST_ADMIN. */
    deleteMe: (body: { password: string; totp?: string }) => http.request<{ purgeAfter: string }>("DELETE", "/users/me", { body }),
    /** Everything the account holds, as a JSON file (rate limited: 429 after 3 a day). */
    exportData: () => download("/users/me/export"),
    sessions: () => get<SessionInfo[]>("/users/me/sessions"),
    revokeSession: (id: string) => del(`/users/me/sessions/${enc(id)}`),
  };

  const media = {
    upload: (opts: UploadOptions) => uploadMedia(http, opts),
    get: (id: string) => get<Media>(`/media/${enc(id)}`),
    discard: (uploadId: string) => del(`/media/uploads/${enc(uploadId)}`),
  };

  const notifications = {
    list: (q?: PageQuery & { unread?: boolean }) => get<Page<Notification>>("/notifications", pq(q)),
    counts: () => get<NotificationCounts>("/notifications/counts"),
    read: (id: string) => post(`/notifications/${enc(id)}/read`),
    readAll: () => post("/notifications/read-all"),
  };

  return { auth, meta, users, media, notifications };
}
