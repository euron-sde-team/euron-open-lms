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
}

export interface AuthResult {
  accessToken: string;
  /** Seconds until the access token expires; refresh through POST /api/auth/refresh. */
  expiresIn: number;
  user: Me;
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
