/**
 * GET /api/admin/stats and /stats.csv (overview area). The range is a pair of local
 * dates in settings.analytics.timezone (default: the last 30 days, today included), at
 * most 366 days.
 *
 * Instructors get the same shape restricted to the courses they are on: learners,
 * enrollments, completions and grading of those courses, and revenue attributed from
 * the course lines of paid orders (bundle and plan sales are not attributed to a
 * course). MRR is an academy-wide figure, so it is empty for them.
 */
import type { AdminStats } from "@open-lms/types";
import type { Response } from "express";
import { requireArea, type Actor } from "../core/context";
import { badRequest } from "../core/errors";
import { adminStatsRepo, type CourseScope, type StatsRange } from "../repositories/admin-stats.repository";
import { manageableCourseIds } from "./access.service";
import { getSettings } from "./settings.service";

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date (YYYY-MM-DD) in a time zone. */
export function localToday(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function validDate(d: string): boolean {
  if (!DATE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/** Resolve and check a requested range. Pure, exported for the unit tests. */
export function resolveRange(q: { from?: string; to?: string }, timezone: string, now = new Date()): StatsRange {
  const to = q.to ?? localToday(timezone, now);
  const from = q.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * DAY_MS).toISOString().slice(0, 10);
  if (!validDate(from) || !validDate(to)) throw badRequest("Dates must be real days, written YYYY-MM-DD", "RANGE_INVALID");
  if (from > to) throw badRequest("The start date is after the end date", "RANGE_INVALID");
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS + 1 > MAX_DAYS) throw badRequest(`Pick a range of at most ${MAX_DAYS} days`, "RANGE_TOO_LONG");
  return { from, to, timezone };
}

async function scopeOf(actor: Actor): Promise<CourseScope> {
  return actor.role === "INSTRUCTOR" ? ((await manageableCourseIds(actor)) ?? []) : null;
}

export async function stats(actor: Actor, q: { from?: string; to?: string }): Promise<AdminStats> {
  requireArea(actor, "overview");
  const range = resolveRange(q, (await getSettings()).analytics.timezone);
  const scope = await scopeOf(actor);
  const [totals, revenue, mrr, daily, topCourses] = await Promise.all([
    adminStatsRepo.totals(range, scope),
    adminStatsRepo.revenue(range, scope),
    scope === null ? adminStatsRepo.mrr() : Promise.resolve([]),
    adminStatsRepo.daily(range, scope),
    adminStatsRepo.topCourses(range, scope),
  ]);
  return { range, revenue, mrr, totals, daily, topCourses };
}

/** The daily series as CSV, streamed row by row. No personal data. */
export async function streamStatsCsv(actor: Actor, q: { from?: string; to?: string }, res: Response): Promise<void> {
  requireArea(actor, "overview");
  const range = resolveRange(q, (await getSettings()).analytics.timezone);
  const daily = await adminStatsRepo.daily(range, await scopeOf(actor));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="overview-${range.from}-to-${range.to}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  const write = (line: string) => new Promise<void>((resolve) => (res.write(line) ? resolve() : res.once("drain", resolve)));
  await write("date,signups,enrollments,completions,orders\n");
  for (const d of daily) await write(`${d.date},${d.signups},${d.enrollments},${d.completions},${d.orders}\n`);
  res.end();
}
