/**
 * The one place that loads the facts for domain/entitlements.ts and turns its decision
 * into an HTTP answer. Every content route calls `requireCourseAccess` (or
 * `requireItemAccess` for one item, which also lets free previews through); authoring
 * routes call `requireCourseStaff`.
 *
 * Unknown and unpublished courses are 404 to learners (never confirm a draft exists);
 * a published course without access is 403 COURSE_ACCESS_REQUIRED with the reason, so
 * the web app can show "Enroll", "Your access expired" or "Included in Pro".
 */
import type { CourseStaffRole } from "@open-lms/types";
import { type Actor } from "../core/context";
import { forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { seesAllCourses } from "../domain/admin-permissions";
import { decideAccess, subscriptionGrantsAccess, type AccessDecision, type AccessFacts } from "../domain/entitlements";
import { getSettings } from "./settings.service";

export interface CourseRef {
  id: string;
  slug: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  access_mode: "FREE" | "PAID" | "SUBSCRIPTION_ONLY";
  included_in_subscription: boolean;
}

export interface Granted {
  course: CourseRef;
  decision: Extract<AccessDecision, { granted: true }>;
  /** The learner's enrollment (created on first open for subscription access); null for staff. */
  enrollmentId: string | null;
}

const COURSE_COLUMNS = ["id", "slug", "title", "status", "access_mode", "included_in_subscription"] as const;

export function findCourse(by: { id?: string; slug?: string }, exec: Executor = db): Promise<CourseRef | undefined> {
  let q = exec.selectFrom("courses").select([...COURSE_COLUMNS]);
  q = by.id ? q.where("id", "=", by.id) : q.where("slug", "=", by.slug ?? "");
  return q.executeTakeFirst() as Promise<CourseRef | undefined>;
}

export async function staffRoleOn(userId: string, courseId: string, exec: Executor = db): Promise<CourseStaffRole | null> {
  const r = await exec.selectFrom("course_staff").select("role").where("course_id", "=", courseId).where("user_id", "=", userId).executeTakeFirst();
  return r?.role ?? null;
}

/** The live (or most recent) subscription row that could grant access. */
export function subscriptionFacts(userId: string, exec: Executor = db) {
  return exec
    .selectFrom("subscriptions")
    .select(["status", "current_period_end", "trial_end"])
    .where("user_id", "=", userId)
    .where("status", "in", ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"])
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
}

/** Does the viewer's subscription unlock included courses right now? */
export async function hasPlanAccess(userId: string, exec: Executor = db): Promise<boolean> {
  const [sub, settings] = await Promise.all([subscriptionFacts(userId, exec), getSettings(exec)]);
  return subscriptionGrantsAccess(sub ? { status: sub.status, currentPeriodEnd: sub.current_period_end, trialEnd: sub.trial_end } : null, new Date(), settings.learning.subscriptionGraceDays);
}

export async function accessFacts(viewer: Actor | null, course: CourseRef, exec: Executor = db): Promise<AccessFacts & { enrollmentId: string | null }> {
  const settings = await getSettings(exec);
  if (!viewer) {
    return { course: toCourseFacts(course), viewer: null, staffRole: null, enrollment: null, subscription: null, now: new Date(), graceDays: settings.learning.subscriptionGraceDays, enrollmentId: null };
  }
  const [staffRole, enrollment, sub] = await Promise.all([
    staffRoleOn(viewer.id, course.id, exec),
    exec
      .selectFrom("enrollments as e")
      .leftJoin("orders as o", "o.id", "e.order_id")
      .select(["e.id", "e.source", "e.status", "e.valid_until", "o.status as order_status"])
      .where("e.user_id", "=", viewer.id)
      .where("e.course_id", "=", course.id)
      .executeTakeFirst(),
    subscriptionFacts(viewer.id, exec),
  ]);
  return {
    course: toCourseFacts(course),
    viewer: { role: viewer.role, active: viewer.status === "ACTIVE" || viewer.status === "SUSPENDED" },
    staffRole,
    enrollment: enrollment
      ? { source: enrollment.source, status: enrollment.status, validUntil: enrollment.valid_until, refunded: enrollment.order_status === "REFUNDED" }
      : null,
    subscription: sub ? { status: sub.status, currentPeriodEnd: sub.current_period_end, trialEnd: sub.trial_end } : null,
    now: new Date(),
    graceDays: settings.learning.subscriptionGraceDays,
    enrollmentId: enrollment?.id ?? null,
  };
}

function toCourseFacts(c: CourseRef): AccessFacts["course"] {
  return { status: c.status, accessMode: c.access_mode, includedInSubscription: c.included_in_subscription };
}

export async function decide(viewer: Actor | null, course: CourseRef, exec: Executor = db): Promise<{ decision: AccessDecision; enrollmentId: string | null; staffRole: CourseStaffRole | null }> {
  const facts = await accessFacts(viewer, course, exec);
  return { decision: decideAccess(facts), enrollmentId: facts.enrollmentId, staffRole: facts.staffRole };
}

/**
 * The course, if the viewer may open its content. Subscription access with no
 * enrollment row yet creates one (source SUBSCRIPTION), so progress has a home.
 */
export async function requireCourseAccess(viewer: Actor | null, by: { id?: string; slug?: string }, exec: Executor = db): Promise<Granted> {
  const course = await findCourse(by, exec);
  if (!course) throw notFound("Course not found");
  const { decision, enrollmentId } = await decide(viewer, course, exec);
  if (!decision.granted) {
    if (decision.reason === "NOT_PUBLISHED") throw notFound("Course not found");
    if (decision.reason === "SIGNED_OUT") throw forbidden("Sign in to open this course", "SIGN_IN_REQUIRED");
    throw forbidden("You do not have access to this course", "COURSE_ACCESS_REQUIRED", { reason: decision.reason });
  }
  let id = enrollmentId;
  if (decision.via === "SUBSCRIPTION" && viewer) id = await ensureSubscriptionEnrollment(viewer.id, course.id, exec);
  return { course, decision, enrollmentId: decision.via === "STAFF" ? enrollmentId : id };
}

/**
 * Turn subscription access into an enrollment row. An existing lapsed row (an expired
 * grant, an ended subscription) is re-pointed at the subscription; progress is kept.
 */
export async function ensureSubscriptionEnrollment(userId: string, courseId: string, exec: Executor = db): Promise<string> {
  const row = await exec
    .insertInto("enrollments")
    .values({ id: newId(), user_id: userId, course_id: courseId, source: "SUBSCRIPTION", last_activity_at: new Date() })
    .onConflict((oc) =>
      oc.columns(["user_id", "course_id"]).doUpdateSet({ source: "SUBSCRIPTION", status: "ACTIVE", revoked_at: null, revoked_reason: null, valid_until: null, updated_at: new Date() }),
    )
    .returning(["id", "created_at", "updated_at"])
    .executeTakeFirstOrThrow();
  // A brand-new row counts as an enrollment on the course card.
  if (row.created_at.getTime() === row.updated_at.getTime()) {
    await exec.updateTable("courses").set((eb) => ({ enrollment_count: eb("enrollment_count", "+", 1) })).where("id", "=", courseId).execute();
  }
  return row.id;
}

/**
 * One curriculum item: the course access above, or the item is a free preview of a
 * published course (anyone, signed in or not, may open previews).
 */
export async function requireItemAccess(viewer: Actor | null, itemId: string, exec: Executor = db): Promise<Granted & { item: { id: string; course_id: string; section_id: string; kind: "LECTURE" | "QUIZ" | "ASSIGNMENT"; title: string; is_preview: boolean; duration_seconds: number }; preview: boolean }> {
  const item = await exec.selectFrom("course_items").select(["id", "course_id", "section_id", "kind", "title", "is_preview", "duration_seconds"]).where("id", "=", itemId).executeTakeFirst();
  if (!item) throw notFound("Item not found");
  const course = await findCourse({ id: item.course_id }, exec);
  if (!course) throw notFound("Item not found");
  const { decision, enrollmentId } = await decide(viewer, course, exec);
  if (decision.granted) {
    let id = enrollmentId;
    if (decision.via === "SUBSCRIPTION" && viewer) id = await ensureSubscriptionEnrollment(viewer.id, course.id, exec);
    return { course, decision, enrollmentId: id, item, preview: false };
  }
  if (item.is_preview && course.status === "PUBLISHED" && item.kind === "LECTURE") {
    return { course, decision: { granted: true, via: "ENROLLMENT" }, enrollmentId: null, item, preview: true };
  }
  if (decision.reason === "NOT_PUBLISHED") throw notFound("Item not found");
  if (decision.reason === "SIGNED_OUT") throw forbidden("Sign in to open this lesson", "SIGN_IN_REQUIRED");
  throw forbidden("You do not have access to this course", "COURSE_ACCESS_REQUIRED", { reason: decision.reason, courseSlug: course.slug });
}

/**
 * Authoring rights on one course. Admins may do everything; SUPPORT may read; an
 * instructor needs a staff role on the course from `roles`.
 */
export async function requireCourseStaff(actor: Actor, courseId: string, roles: readonly CourseStaffRole[], opts: { write: boolean } = { write: true }, exec: Executor = db): Promise<{ course: CourseRef; role: CourseStaffRole | null }> {
  const course = await findCourse({ id: courseId }, exec);
  if (!course) throw notFound("Course not found");
  if (actor.role === "ADMIN") return { course, role: await staffRoleOn(actor.id, courseId, exec) };
  const role = await staffRoleOn(actor.id, courseId, exec);
  if (role && roles.includes(role)) return { course, role };
  if (!opts.write && seesAllCourses(actor.role)) return { course, role };
  // Instructors cannot even confirm someone else's course exists.
  throw notFound("Course not found");
}

/** Course ids an operator may manage (null = every course). */
export async function manageableCourseIds(actor: Actor, exec: Executor = db): Promise<string[] | null> {
  if (seesAllCourses(actor.role)) return null;
  const rows = await exec.selectFrom("course_staff").select("course_id").where("user_id", "=", actor.id).execute();
  return rows.map((r) => r.course_id);
}
