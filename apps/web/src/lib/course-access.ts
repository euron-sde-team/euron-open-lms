/**
 * What the course page offers the viewer, from `CourseDetail.access` (computed by the
 * API; the web app never decides access itself). Pure, so every state is unit-tested.
 */
import type { CourseAccess, Money } from "@open-lms/types";
import { formatMoney } from "./money";

export type CtaAction =
  | { kind: "link"; href: string }
  /** POST /catalog/courses/:slug/enroll, then open the classroom. */
  | { kind: "enroll" };

export interface AccessCta {
  /** The one lit button; null when nothing can be done (UNAVAILABLE). */
  primary: ({ label: string; testId: string } & CtaAction) | null;
  /** A quiet text link under the button. */
  secondary: { label: string; href: string } | null;
  /** One line of plain explanation (why it is locked, what is included). */
  note: string | null;
  /** The price to show above the button, if any. */
  price: Money | null;
  compareAt: Money | null;
  /** True when the viewer already has access (progress shows instead of a price). */
  hasAccess: boolean;
}

export const learnHref = (slug: string, itemId?: string | null) => `/learn/${encodeURIComponent(slug)}${itemId ? `/${encodeURIComponent(itemId)}` : ""}`;

export function checkoutHref(type: "COURSE" | "BUNDLE", id: string, currency?: string | null): string {
  const p = new URLSearchParams({ type, id });
  if (currency) p.set("currency", currency);
  return `/checkout?${p.toString()}`;
}

export const loginHref = (next: string) => `/login?next=${encodeURIComponent(next)}`;
export const signupHref = (next: string) => `/signup?next=${encodeURIComponent(next)}`;

export const LAPSED_COPY: Record<Extract<CourseAccess, { state: "LAPSED" }>["reason"], string> = {
  EXPIRED: "Your access to this course has ended. Your progress is saved.",
  REVOKED: "Your access to this course was removed. Your progress is saved.",
  SUBSCRIPTION_ENDED: "Your plan has ended, so this course is locked. Your progress is saved.",
  REFUNDED: "This purchase was refunded, so the course is locked. Your progress is saved.",
};

const base = { primary: null, secondary: null, note: null, price: null, compareAt: null, hasAccess: false } satisfies AccessCta;

export function accessCta(course: { id: string; slug: string; access: CourseAccess }, opts: { currency?: string | null; path?: string } = {}): AccessCta {
  const { access, slug, id } = course;
  const path = opts.path ?? `/courses/${encodeURIComponent(slug)}`;
  switch (access.state) {
    case "ENROLLED":
      return {
        ...base,
        hasAccess: true,
        primary: { kind: "link", href: learnHref(slug, access.resumeItemId), label: access.progressPercent > 0 || access.completedAt ? "Continue learning" : "Start learning", testId: "cta-continue" },
        note: access.completedAt ? "You completed this course." : null,
      };
    case "FREE":
      return { ...base, primary: { kind: "enroll", label: "Enroll for free", testId: "cta-enroll" }, note: "Free. Your progress and certificate are kept." };
    case "INCLUDED_IN_PLAN":
      return { ...base, hasAccess: true, primary: { kind: "link", href: learnHref(slug), label: "Start learning", testId: "cta-start" }, note: "Included in your plan." };
    case "PURCHASABLE":
      return {
        ...base,
        price: access.price,
        compareAt: access.compareAt,
        primary: { kind: "link", href: checkoutHref("COURSE", id, access.price.currency ?? opts.currency), label: `Buy now · ${formatMoney(access.price, { compact: true })}`, testId: "cta-buy" },
        secondary: access.subscriptionAlso ? { label: "or get it with a plan", href: "/plans" } : null,
      };
    case "SUBSCRIPTION_REQUIRED":
      return { ...base, primary: { kind: "link", href: "/plans", label: "See plans", testId: "cta-plans" }, note: "This course is available with a plan." };
    case "LAPSED": {
      const note = LAPSED_COPY[access.reason];
      if (access.price) {
        return {
          ...base,
          note,
          price: access.price,
          primary: { kind: "link", href: checkoutHref("COURSE", id, access.price.currency ?? opts.currency), label: `Buy again · ${formatMoney(access.price, { compact: true })}`, testId: "cta-buy-again" },
          secondary: access.reason === "SUBSCRIPTION_ENDED" ? { label: "or renew a plan", href: "/plans" } : null,
        };
      }
      if (access.reason === "SUBSCRIPTION_ENDED") return { ...base, note, primary: { kind: "link", href: "/plans", label: "See plans", testId: "cta-plans" } };
      return { ...base, note };
    }
    case "UNAVAILABLE":
      return { ...base, note: "This course is not on sale in your currency right now." };
    case "STAFF":
      return { ...base, hasAccess: true, primary: { kind: "link", href: learnHref(slug), label: "Open classroom (staff preview)", testId: "cta-staff" }, note: "You are on this course's team, so progress is not recorded." };
    case "SIGNED_OUT":
      return {
        ...base,
        price: access.price,
        primary: { kind: "link", href: loginHref(path), label: access.free ? "Sign in to enroll for free" : "Sign in to get this course", testId: "cta-signin" },
        secondary: { label: "New here? Create an account", href: signupHref(path) },
        note: access.free ? "Free with an account." : null,
      };
  }
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "This course includes": one plain line per real count, nothing invented. */
export function courseIncludes(c: { counts: { lectures: number; quizzes: number; assignments: number; articles: number; pdfs: number }; durationSeconds: number; certificateEnabled: boolean }, formatDuration: (s: number) => string): string[] {
  const out: string[] = [];
  if (c.counts.lectures) out.push(c.durationSeconds > 0 ? `${plural(c.counts.lectures, "video lesson", "video lessons")}, ${formatDuration(c.durationSeconds)} in all` : plural(c.counts.lectures, "video lesson", "video lessons"));
  if (c.counts.articles) out.push(plural(c.counts.articles, "article", "articles"));
  if (c.counts.pdfs) out.push(plural(c.counts.pdfs, "PDF to read or download", "PDFs to read or download"));
  if (c.counts.quizzes) out.push(plural(c.counts.quizzes, "quiz", "quizzes"));
  if (c.counts.assignments) out.push(plural(c.counts.assignments, "project reviewed by an instructor", "projects reviewed by instructors"));
  if (c.certificateEnabled) out.push("A certificate when you finish");
  return out;
}
