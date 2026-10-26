/**
 * My Learning: the learner's courses with progress, the dashboard numbers, the
 * wishlist and bookmarks.
 *
 * A lapsed enrollment stays listed with `active: false`, so progress is never lost
 * from view. `active` is the same decision services/access.service.ts makes
 * (domain/entitlements.ts decideAccess), built here from batch-loaded facts so a page
 * of twenty courses does not cost twenty access checks.
 */
import type { CourseCard, ItemKind, LearningEntry, LearningSummary, Page } from "@open-lms/types";
import type { Actor } from "../core/context";
import { resumeTarget } from "../domain/curriculum";
import { decideAccess } from "../domain/entitlements";
import { streak } from "../domain/progress";
import { displayCurrency, presentCardMap, presentCards } from "../presenters/course-card.presenter";
import { courseCardRepo } from "../repositories/course-card.repository";
import { decodeTime, timePage } from "../repositories/keyset";
import { decodeActivity, encodeActivity, myLearningRepo } from "../repositories/my-learning.repository";
import { subscriptionFacts } from "./access.service";
import { getSettings } from "./settings.service";

export async function learning(actor: Actor, q: { status?: "in_progress" | "completed" | "all"; cursor?: string; limit?: number }): Promise<Page<LearningEntry>> {
  const limit = q.limit ?? 20;
  const rows = await myLearningRepo.enrollments(actor.id, { status: q.status ?? "all", cursor: decodeActivity(q.cursor), limit });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const courseIds = page.map((r) => r.course_id);

  const [cardRows, items, completedRows, staff, certs, sub, settings, currency] = await Promise.all([
    courseCardRepo.byIds(courseIds),
    myLearningRepo.itemsOf(courseIds),
    myLearningRepo.completedItems(actor.id, courseIds),
    myLearningRepo.staffRoles(actor.id, courseIds),
    myLearningRepo.certificates(actor.id, courseIds),
    subscriptionFacts(actor.id),
    getSettings(),
    displayCurrency(actor, undefined),
  ]);
  const { cards } = await presentCardMap(cardRows, { viewer: actor, currency });
  const completed = new Set(completedRows.map((r) => r.item_id));
  const staffBy = new Map(staff.map((s) => [s.course_id, s.role]));
  const certBy = new Map(certs.map((c) => [c.course_id, c.serial]));
  const itemsBy = new Map<string, { id: string; title: string; kind: ItemKind }[]>();
  for (const i of items) itemsBy.set(i.course_id, [...(itemsBy.get(i.course_id) ?? []), { id: i.id, title: i.title, kind: i.kind }]);
  const now = new Date();
  const subscription = sub ? { status: sub.status, currentPeriodEnd: sub.current_period_end, trialEnd: sub.trial_end } : null;

  const entries = page
    .map((r): LearningEntry | null => {
      const course = cards.get(r.course_id);
      if (!course) return null;
      const courseItems = itemsBy.get(r.course_id) ?? [];
      const resumeId = resumeTarget(courseItems.map((i) => i.id), completed, r.last_item_id);
      const resume = courseItems.find((i) => i.id === resumeId) ?? null;
      const decision = decideAccess({
        course: { status: r.course_status, accessMode: r.access_mode, includedInSubscription: r.included_in_subscription },
        viewer: { role: actor.role, active: actor.status === "ACTIVE" || actor.status === "SUSPENDED" },
        staffRole: staffBy.get(r.course_id) ?? null,
        enrollment: { source: r.source, status: r.status, validUntil: r.valid_until, refunded: r.order_status === "REFUNDED" },
        subscription,
        now,
        graceDays: settings.learning.subscriptionGraceDays,
      });
      return {
        course,
        enrollmentId: r.id,
        source: r.source,
        progressPercent: r.progress_percent,
        completedItems: r.completed_items,
        totalItems: courseItems.length || r.item_count,
        completedAt: r.completed_at?.toISOString() ?? null,
        lastActivityAt: r.last_activity_at?.toISOString() ?? null,
        resumeItem: resume,
        validUntil: r.valid_until?.toISOString() ?? null,
        active: decision.granted,
        certificate: certBy.has(r.course_id) ? { serial: certBy.get(r.course_id) as string } : null,
      };
    })
    .filter((e): e is LearningEntry => !!e);
  const last = page[page.length - 1];
  return { items: entries, nextCursor: hasMore && last ? encodeActivity(last.last_activity_at, last.id) : null };
}

/** A valid IANA zone for SQL's AT TIME ZONE (a bad setting falls back to UTC instead of failing). */
function safeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

export async function summary(actor: Actor): Promise<LearningSummary> {
  const settings = await getSettings();
  const [counts, minutes, activity] = await Promise.all([myLearningRepo.counts(actor.id), myLearningRepo.minutesThisWeek(actor.id), myLearningRepo.activityDays(actor.id, safeZone(settings.analytics.timezone))]);
  return { ...counts, minutesThisWeek: minutes, streakDays: streak(activity.days, activity.today) };
}

export async function saved(actor: Actor, q: { cursor?: string; limit?: number }): Promise<Page<CourseCard>> {
  const limit = q.limit ?? 20;
  const page = timePage(await myLearningRepo.saved(actor.id, decodeTime(q.cursor), limit), limit);
  const rows = await courseCardRepo.byIds(page.items.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = page.items.map((r) => byId.get(r.id)).filter((r) => !!r);
  return { items: await presentCards(ordered, { viewer: actor, currency: await displayCurrency(actor, undefined) }), nextCursor: page.nextCursor };
}

export async function bookmarks(actor: Actor, q: { cursor?: string; limit?: number }) {
  const limit = q.limit ?? 20;
  const page = timePage(await myLearningRepo.bookmarks(actor.id, decodeTime(q.cursor), limit), limit);
  return {
    items: page.items.map((b) => ({ item: { id: b.id, title: b.title, kind: b.kind }, course: { slug: String(b.course_slug), title: b.course_title }, createdAt: b.created_at.toISOString() })),
    nextCursor: page.nextCursor,
  };
}
