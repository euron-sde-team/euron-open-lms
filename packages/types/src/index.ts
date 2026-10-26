/**
 * The API contract shared by apps/api and apps/web: response shapes (DTOs). Timestamps
 * are ISO-8601 strings. Ids are ULIDs. Money is always { amountMinor, currency }.
 *
 * Changing a shape here is a breaking change for one side or the other; both apps
 * typecheck against this file, so the compiler finds every caller.
 */

// ─── Enums (mirrors db/migrations) ──────────────────────────────────────────

export const USER_ROLES = ["LEARNER", "INSTRUCTOR", "SUPPORT", "FINANCE", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "BANNED" | "DEACTIVATED";
export type UploadPurpose = "AVATAR" | "COURSE_COVER" | "LECTURE_PDF" | "LECTURE_RESOURCE" | "SUBMISSION" | "BRANDING";
export type UploadKind = "IMAGE" | "VIDEO" | "AUDIO" | "PDF" | "DOCUMENT" | "ARCHIVE" | "OTHER";
export type UploadStatus = "PENDING" | "COMPLETE" | "READY" | "REJECTED" | "DELETED";
export type ContentStatus = "PUBLISHED" | "HIDDEN" | "DELETED";

export type NotificationType =
  | "ORDER_PAID" | "ORDER_FAILED" | "REFUND_ISSUED"
  | "ENROLLMENT_GRANTED" | "ENROLLMENT_REVOKED"
  | "SUBMISSION_REVIEWED" | "CERTIFICATE_ISSUED"
  | "SUBSCRIPTION_RENEWED" | "SUBSCRIPTION_PAYMENT_FAILED" | "SUBSCRIPTION_CANCELED"
  | "QA_REPLY" | "QA_ACCEPTED" | "REVIEW_REPLY" | "COURSE_UPDATED";

/** The email categories a learner may switch off (receipts and security mail always go). */
export const EMAIL_CATEGORIES = ["LEARNING", "COMMUNITY", "BILLING_REMINDERS", "PRODUCT_UPDATES"] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/**
 * Push notifications use the same categories. Defaults for a learner who never touched a
 * switch: learning, community and billing reminders on, product updates off. Receipts,
 * refunds and access changes are always pushed (they have no category).
 */
export const PUSH_DEFAULTS: Readonly<Record<EmailCategory, boolean>> = { LEARNING: true, COMMUNITY: true, BILLING_REMINDERS: true, PRODUCT_UPDATES: false };

export type PushPlatform = "IOS" | "ANDROID";

// ─── Envelopes ──────────────────────────────────────────────────────────────

/** Keyset page: pass `nextCursor` back as `?cursor=` until it is null. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Every non-2xx response. `code` is stable; switch on it, not on `error`. */
export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
  requestId?: string;
}

/** An amount in the currency's minor unit (cents, paise). Format with Intl on display. */
export interface Money {
  amountMinor: number;
  currency: string;
}

// ─── People ─────────────────────────────────────────────────────────────────

export interface Media {
  id: string;
  kind: UploadKind;
  mimeType: string;
  fileName: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  /** Short-lived signed URL; refetch the parent resource after it expires. */
  url: string;
  thumbUrl: string | null;
  status: UploadStatus;
}

/** The person card shown wherever someone appears (instructors, Q&A, reviews, admin). */
export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  headline: string | null;
  role: UserRole;
}

export interface Me extends UserSummary {
  email: string;
  status: UserStatus;
  /** When a SUSPENDED account's suspension ends (ISO); null otherwise. */
  suspendedUntil: string | null;
  emailVerified: boolean;
  totpEnabled: boolean;
  bio: string | null;
  website: string | null;
  /** The name printed on certificates (falls back to displayName). */
  certificateName: string | null;
  preferredCurrency: string | null;
  emailPreferences: Record<EmailCategory, boolean>;
  /** Per-category push switches (PUSH_DEFAULTS until changed). */
  pushPreferences: Record<EmailCategory, boolean>;
  /** Set while an account deletion is pending; signing in again cancels it. */
  deletionRequestedAt: string | null;
  /** True when the account may open /admin (any staff role, or an instructor). */
  canOpenAdmin: boolean;
  /** The learner's live subscription, if any (drives "Included in your plan" badges). */
  subscription: SubscriptionSummary | null;
}

/** GET /api/meta: public facts about this academy, for page titles, checkout and sign-up. */
export interface AcademyMeta {
  academyName: string;
  tagline: string;
  logoUrl: string | null;
  registration: "OPEN" | "CLOSED";
  /** Currencies the price book sells in, the default first. */
  currencies: string[];
  defaultCurrency: string;
  /** Which gateway handles which currency, and the public keys the browser needs. */
  payments: {
    stripe: { enabled: boolean; publishableKey: string | null };
    razorpay: { enabled: boolean; keyId: string | null; checkoutScriptUrl: string };
    routing: Record<string, "STRIPE" | "RAZORPAY">;
  };
  /** Whether any plan is on sale (shows the "Plans" nav entry). */
  subscriptions: boolean;
  ai: { quizGeneration: boolean; gradingAssist: boolean; polish: boolean };
  support: { email: string | null };
  /** What the mobile app needs to know before anyone signs in. */
  mobile: {
    /** iOS may link out to the web checkout (allowed in some storefronts); otherwise purchases are hidden on iOS. */
    iosWebPurchaseLink: boolean;
    /** Older app versions are asked to update ("1.4.0"); null when every version is supported. */
    minSupportedVersion: string | null;
    /** Offline downloads are switched on in the academy settings. */
    downloadsEnabled: boolean;
    /** This server can send push notifications (PUSH_PROVIDER is not none). */
    pushEnabled: boolean;
    /** App URL schemes checkout may hand back to (MOBILE_RETURN_SCHEMES), for the web's /checkout/app-return page. */
    appReturnSchemes: string[];
  };
}

export interface AuthResult {
  accessToken: string;
  /** Seconds until the access token expires; refresh through POST /api/auth/refresh. */
  expiresIn: number;
  user: Me;
}

/**
 * The same session for a native app (request header `X-Client: native`): the refresh
 * token comes back in the body instead of a cookie. Keep it in the platform keystore and
 * send it as `{ refreshToken }` to POST /api/auth/refresh and /api/auth/logout.
 */
export interface IssuedNativeSession extends AuthResult {
  refreshToken: string;
  /** ISO time after which the refresh token no longer works (sign in again). */
  refreshExpiresAt: string;
}

/** PUT /api/my/devices: an installed app that may receive push notifications. */
export interface PushDevice {
  id: string;
  platform: PushPlatform;
  appVersion: string | null;
  locale: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/** The `data` of every push message: where the app should open (an app path, like Notification.href). */
export interface PushData {
  type: NotificationType;
  url: string;
  notificationId: string;
}

// ─── Notifications ──────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: NotificationType;
  actor: UserSummary | null;
  entityType: string;
  entityId: string;
  snippet: string | null;
  /** Where the web app should navigate on click (a path, not a full URL). */
  href: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationCounts {
  notifications: number;
}

export * from "./learning";
export * from "./commerce";
export * from "./admin";

import type { SubscriptionSummary } from "./commerce";
