/**
 * The moderation queue (admin area "moderation"). Resolving a report acts on the
 * reported content and closes every open report on it:
 *
 *   HIDE     PUBLISHED -> HIDDEN (a hidden review stops counting in the course rating;
 *            a hidden reply stops counting in the thread's reply_count)
 *   RESTORE  HIDDEN -> PUBLISHED (the counters come back)
 *   DISMISS  the content stays as it is
 *
 * HIDE and RESTORE also work on an already resolved report (undoing a decision);
 * DISMISS on a resolved one is 409 ALREADY_RESOLVED. Content its author deleted is not
 * restored. Every resolution is audited in the same transaction.
 */
import type { AdminReport } from "@open-lms/types";
import type { Transaction } from "kysely";
import { requireArea, type Actor, type RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict, notFound } from "../core/errors";
import type { DB } from "../db/types";
import { presentReports } from "../presenters/report.presenter";
import { decodeTime, timePage, type Paged } from "../repositories/keyset";
import { qaRepo } from "../repositories/qa.repository";
import { reportRepo, type ReportRow } from "../repositories/report.repository";
import { reviewRepo } from "../repositories/review.repository";
import { audit } from "./audit.service";

export type ModerationAction = "HIDE" | "RESTORE" | "DISMISS";

/** GET /admin/moderation/reports */
export async function listReports(actor: Actor, q: { status: "OPEN" | "RESOLVED"; cursor?: string; limit: number }): Promise<Paged<AdminReport>> {
  requireArea(actor, "moderation");
  const page = timePage(await reportRepo.list({ status: q.status, cursor: decodeTime(q.cursor), limit: q.limit }), q.limit);
  return { items: await presentReports(page.items), nextCursor: page.nextCursor };
}

/** Change the target's visibility, keeping the counters right. Returns whether anything changed. */
async function setVisibility(report: ReportRow, hide: boolean, trx: Transaction<DB>): Promise<boolean> {
  const [from, to] = hide ? (["PUBLISHED", "HIDDEN"] as const) : (["HIDDEN", "PUBLISHED"] as const);
  const sign = hide ? -1 : 1;
  if (report.target_type === "REVIEW") {
    const r = await reviewRepo.setStatus(report.target_id, from, to, trx);
    if (r) await reviewRepo.adjustCourseRating(r.course_id, sign, sign * r.rating, trx);
    return !!r;
  }
  if (report.target_type === "QA_THREAD") return !!(await qaRepo.setThreadStatus(report.target_id, [from], to, trx));
  const reply = await qaRepo.setReplyStatus(report.target_id, [from], to, trx);
  if (reply) await qaRepo.bumpThread(reply.thread_id, sign, false, trx);
  return !!reply;
}

/** POST /admin/moderation/reports/:id/resolve */
export async function resolve(actor: Actor, reportId: string, input: { action: ModerationAction; note: string | null }, m: RequestMeta): Promise<AdminReport> {
  requireArea(actor, "moderation");
  const row = await withTransaction(async (trx) => {
    const report = await reportRepo.lock(reportId, trx);
    if (!report) throw notFound("Report not found");
    if (input.action === "DISMISS" && report.status === "RESOLVED") throw conflict("This report is already resolved", "ALREADY_RESOLVED");
    const changed = input.action === "DISMISS" ? false : await setVisibility(report, input.action === "HIDE", trx);
    const resolution = input.note ? `${input.action}: ${input.note}` : input.action;
    const closed = await reportRepo.closeOpen({ type: report.target_type, id: report.target_id }, { resolution, resolvedBy: actor.id }, trx);
    const updated = await trx
      .updateTable("reports")
      .set({ status: "RESOLVED", resolution, resolved_by: actor.id, resolved_at: new Date() })
      .where("id", "=", reportId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(
      {
        actorId: actor.id,
        action: "moderation.resolve",
        entityType: report.target_type.toLowerCase(),
        entityId: report.target_id,
        ip: m.ip,
        data: { reportId, action: input.action, note: input.note, changed, closedReports: closed },
      },
      trx,
    );
    return updated;
  });
  return (await presentReports([row]))[0]!;
}
