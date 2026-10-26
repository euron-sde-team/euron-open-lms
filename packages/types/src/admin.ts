/** The /admin control plane: authoring, operations, settings and the audit log. Re-exported from index.ts. */
import type { Media, Money, UserRole, UserStatus, UserSummary } from "./index";
import type {
  AccessMode, CourseLevel, CourseStaffRole, CourseStatus, EnrollmentSource, ItemKind, LectureKind, QuestionKind,
  QuizSelection, ReportReason, ReportTarget, RevealPolicy, RubricCriterion, SubmissionStatus, TextMatch, VideoProvider, VideoStatus,
} from "./learning";
import type {
  BillingInterval, CouponKind, CouponScope, GatewayName, OrderKind, OrderStatus, RefundStatus, SellableType, SubscriptionStatus, TaxMode,
} from "./commerce";

// ─── Access ─────────────────────────────────────────────────────────────────

export const ADMIN_AREAS = ["overview", "courses", "learners", "grading", "orders", "plans", "coupons", "certificates", "moderation", "staff", "settings", "audit"] as const;
export type AdminArea = (typeof ADMIN_AREAS)[number];
export type AdminPermissions = Record<AdminArea, boolean>;

/** GET /api/admin/me: what the operator may open, and which courses an instructor manages. */
export interface AdminSession {
  role: UserRole;
  permissions: AdminPermissions;
  /** True for roles that see every course (ADMIN, SUPPORT); instructors see their own. */
  allCourses: boolean;
}

// ─── Authoring ──────────────────────────────────────────────────────────────

export interface AdminCourseRow {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  status: CourseStatus;
  accessMode: AccessMode;
  itemCount: number;
  enrollmentCount: number;
  rating: { average: number; count: number } | null;
  prices: Money[];
  staff: (UserSummary & { courseRole: CourseStaffRole })[];
  /** The viewer's own role on the course; null for admins who are not on the staff. */
  myRole: CourseStaffRole | null;
  updatedAt: string;
  publishedAt: string | null;
}

export interface AdminPrice {
  id: string;
  currency: string;
  amount: Money;
  compareAt: Money | null;
  interval: BillingInterval | null;
  active: boolean;
}

export interface AdminCourse {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string;
  outcomes: string[];
  prerequisites: string[];
  level: CourseLevel;
  language: string;
  cover: Media | null;
  status: CourseStatus;
  accessMode: AccessMode;
  includedInSubscription: boolean;
  certificateEnabled: boolean;
  featured: boolean;
  categoryIds: string[];
  prices: AdminPrice[];
  staff: (UserSummary & { courseRole: CourseStaffRole; listed: boolean })[];
  myRole: CourseStaffRole | null;
  /** Whether the viewer may change course settings, prices and staff (OWNER or admin). */
  canManage: boolean;
  publishedAt: string | null;
  updatedAt: string;
  sections: AdminSection[];
  /** What blocks publishing, as stable codes the editor turns into a checklist. */
  publishChecklist: { code: "NO_ITEMS" | "NO_COVER" | "NO_PRICE" | "NO_DESCRIPTION" | "VIDEO_NOT_READY" | "EMPTY_QUIZ"; message: string; itemId?: string }[];
}

export interface AdminSection {
  id: string;
  title: string;
  position: number;
  items: AdminItemSummary[];
}

export interface AdminItemSummary {
  id: string;
  kind: ItemKind;
  title: string;
  position: number;
  isPreview: boolean;
  durationSeconds: number;
  lectureKind: LectureKind | null;
  videoStatus: VideoStatus | null;
  /** Quiz: question count; assignment: submissions waiting for review. */
  meta: { questions?: number; pending?: number };
}

export type AdminItem =
  | {
      kind: "LECTURE";
      id: string;
      sectionId: string;
      title: string;
      isPreview: boolean;
      durationSeconds: number;
      lecture: {
        lectureKind: LectureKind;
        videoProvider: VideoProvider | null;
        videoRef: string | null;
        videoStatus: VideoStatus;
        body: string | null;
        pdf: Media | null;
      };
      resources: { id: string; title: string; url: string | null; upload: Media | null }[];
    }
  | {
      kind: "QUIZ";
      id: string;
      sectionId: string;
      title: string;
      isPreview: boolean;
      durationSeconds: number;
      quiz: {
        instructions: string | null;
        selection: QuizSelection;
        drawCount: number | null;
        drawTags: string[];
        passPercent: number;
        timeLimitSeconds: number | null;
        maxAttempts: number | null;
        shuffleQuestions: boolean;
        shuffleOptions: boolean;
        reveal: RevealPolicy;
        questionIds: string[];
      };
    }
  | {
      kind: "ASSIGNMENT";
      id: string;
      sectionId: string;
      title: string;
      isPreview: boolean;
      durationSeconds: number;
      assignment: {
        instructions: string;
        rubric: RubricCriterion[];
        passPoints: number | null;
        dueDays: number | null;
        allowLate: boolean;
        acceptText: boolean;
        acceptFiles: boolean;
        acceptUrl: boolean;
        maxFiles: number;
      };
    };

export interface QuestionOption {
  id: string;
  text: string;
  correct: boolean;
}

export interface AdminQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  explanation: string | null;
  points: number;
  options: QuestionOption[];
  acceptedAnswers: string[];
  matchMode: TextMatch;
  tags: string[];
  usedInQuizzes: number;
  updatedAt: string;
}

/** An EVS video in the picker (GET /api/admin/evs/videos), when an EVS key is configured. */
export interface EvsVideo {
  id: string;
  title: string;
  status: string;
  durationSeconds: number | null;
  posterUrl: string | null;
  createdAt: string;
}

// ─── Grading ────────────────────────────────────────────────────────────────

export interface GradingRow {
  submissionId: string;
  course: { id: string; slug: string; title: string };
  item: { id: string; title: string };
  learner: UserSummary & { email: string };
  version: number;
  status: SubmissionStatus;
  isLate: boolean;
  submittedAt: string;
  hasAiSuggestion: boolean;
}

export interface GradingDetail extends GradingRow {
  instructionsHtml: string;
  rubric: RubricCriterion[];
  passPoints: number | null;
  body: string | null;
  bodyHtml: string | null;
  url: string | null;
  files: Media[];
  previousVersions: { id: string; version: number; status: SubmissionStatus; totalPoints: number | null; submittedAt: string }[];
  review: { scores: Record<string, number>; totalPoints: number; feedback: string | null; reviewer: UserSummary | null; reviewedAt: string } | null;
  aiSuggestion: { scores: Record<string, number>; feedback: string; model: string; createdAt: string } | null;
}

// ─── Learners ───────────────────────────────────────────────────────────────

export interface AdminUserRow extends UserSummary {
  email: string;
  status: UserStatus;
  createdAt: string;
  lastSeenAt: string | null;
  suspendedUntil: string | null;
  enrollmentCount: number;
  totalSpent: Money[];
}

export interface AdminEnrollment {
  id: string;
  course: { id: string; slug: string; title: string };
  source: EnrollmentSource;
  status: "ACTIVE" | "REVOKED";
  /** Whether it grants access right now (entitlements, not just status). */
  grantsAccess: boolean;
  progressPercent: number;
  completedAt: string | null;
  validUntil: string | null;
  grantedBy: UserSummary | null;
  grantNote: string | null;
  orderNumber: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface AdminLearnerDetail extends AdminUserRow {
  bio: string | null;
  emailVerified: boolean;
  totpEnabled: boolean;
  enrollments: AdminEnrollment[];
  subscription: { id: string; plan: string; status: SubscriptionStatus; currentPeriodEnd: string | null } | null;
  recentOrders: AdminOrderRow[];
  certificates: { serial: string; courseTitle: string; issuedAt: string; revoked: boolean }[];
}

// ─── Commerce ───────────────────────────────────────────────────────────────

export interface AdminOrderRow {
  id: string;
  number: string;
  kind: OrderKind;
  status: OrderStatus;
  gateway: GatewayName;
  user: UserSummary & { email: string };
  title: string;
  total: Money;
  refunded: Money;
  couponCode: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface AdminOrderDetail extends AdminOrderRow {
  lines: { type: SellableType; id: string; title: string; unit: Money; discount: Money; tax: Money; total: Money }[];
  subtotal: Money;
  discount: Money;
  tax: Money;
  taxLabel: string | null;
  billing: Record<string, string>;
  gatewayRef: string | null;
  gatewayPaymentRef: string | null;
  failureReason: string | null;
  events: { id: string; type: string; outcome: string | null; receivedAt: string }[];
  refunds: { id: string; amount: Money; reason: string; status: RefundStatus; revokeAccess: boolean; requestedBy: UserSummary | null; createdAt: string; settledAt: string | null }[];
  enrollments: { id: string; courseTitle: string; status: "ACTIVE" | "REVOKED" }[];
  invoices: { id: string; number: string; kind: "INVOICE" | "CREDIT_NOTE" }[];
  /** What is left to refund. */
  refundable: Money;
}

export interface AdminPlan {
  id: string;
  slug: string;
  name: string;
  description: string;
  features: string[];
  trialDays: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  position: number;
  prices: AdminPrice[];
  activeSubscribers: number;
}

export interface AdminBundle {
  id: string;
  slug: string;
  title: string;
  description: string;
  cover: Media | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  courseIds: string[];
  prices: AdminPrice[];
}

export interface AdminSubscriptionRow {
  id: string;
  user: UserSummary & { email: string };
  plan: { id: string; name: string };
  status: SubscriptionStatus;
  gateway: GatewayName;
  price: Money;
  interval: BillingInterval;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export interface AdminCoupon {
  id: string;
  code: string;
  description: string | null;
  kind: CouponKind;
  percentOff: number | null;
  amountOff: Money | null;
  scope: CouponScope;
  targets: { type: SellableType; id: string; title: string }[];
  maxRedemptions: number | null;
  redemptionCount: number;
  perUserLimit: number;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
}

// ─── Certificates, moderation ───────────────────────────────────────────────

export interface AdminCertificateRow {
  id: string;
  serial: string;
  learner: UserSummary & { email: string };
  learnerName: string;
  courseTitle: string;
  issuedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface AdminReport {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  course: { id: string; slug: string; title: string } | null;
  reporter: UserSummary;
  reason: ReportReason;
  note: string | null;
  /** The reported content as it stands now. */
  target: { author: UserSummary | null; excerpt: string; status: "PUBLISHED" | "HIDDEN" | "DELETED"; rating?: number } | null;
  /** Other open reports on the same target. */
  otherReports: number;
  status: "OPEN" | "RESOLVED";
  resolution: string | null;
  createdAt: string;
}

// ─── Overview ───────────────────────────────────────────────────────────────

export interface AdminStats {
  range: { from: string; to: string; timezone: string };
  /** One entry per currency: revenue is never summed across currencies. */
  revenue: { currency: string; gross: number; refunded: number; net: number; orders: number }[];
  mrr: { currency: string; amountMinor: number; subscribers: number }[];
  totals: {
    learners: number;
    newLearners: number;
    activeLearners: number;
    enrollments: number;
    newEnrollments: number;
    completions: number;
    certificates: number;
    publishedCourses: number;
    pendingGrading: number;
    openReports: number;
    refunds: number;
  };
  daily: { date: string; signups: number; enrollments: number; completions: number; orders: number }[];
  topCourses: { id: string; slug: string; title: string; enrollments: number; completions: number; rating: number | null }[];
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface TaxRule {
  /** ISO 3166-1 alpha-2, or "*" for everywhere else. */
  country: string;
  /** Basis points: 1800 = 18%. */
  rateBps: number;
  label: string;
}

export interface LmsSettings {
  academyName: string;
  tagline: string;
  logoUploadId: string | null;
  registration: "OPEN" | "CLOSED";
  supportEmail: string | null;
  currencies: { enabled: string[]; default: string };
  /** Which gateway takes payments in each currency. Unlisted currencies use `fallback`. */
  gateways: { routing: Record<string, "STRIPE" | "RAZORPAY">; fallback: "STRIPE" | "RAZORPAY" };
  tax: { enabled: boolean; mode: TaxMode; rules: TaxRule[] };
  seller: { legalName: string; address: string; taxId: string | null; email: string | null };
  learning: {
    /** Watched share of a video that completes it. */
    videoCompletePercent: number;
    /** Progress a learner needs before leaving a review. */
    reviewMinProgressPercent: number;
    /** Days a PAST_DUE subscription keeps unlocking courses. */
    subscriptionGraceDays: number;
    /** Minutes a PENDING order stays payable. */
    orderTtlMinutes: number;
  };
  certificates: { signatoryName: string; signatoryTitle: string; footer: string };
  analytics: { timezone: string };
}

export interface IntegrationStatus {
  stripe: { configured: boolean; mode: "live" | "test" | "stub" | "off"; webhookConfigured: boolean };
  razorpay: { configured: boolean; mode: "live" | "test" | "stub" | "off"; webhookConfigured: boolean };
  evs: { configured: boolean; baseUrl: string | null; canListVideos: boolean };
  ai: { provider: "openai" | "gemini" | "stub" | "none"; model: string | null };
  mail: { mode: "outbox" | "smtp" | "ses" };
  storage: { mode: "local" | "s3" };
}

export interface AuditEntry {
  id: string;
  actor: UserSummary | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface StaffRow extends UserSummary {
  email: string;
  status: UserStatus;
  courseCount: number;
  createdAt: string;
}
