/**
 * Reports to the moderation queue's DTO (AdminReport): the report, the reported content
 * as it stands now (author, a plain-text excerpt, its status) and how many other open
 * reports the same content has. Targets are batch-loaded per type for the whole page.
 */
import type { AdminReport, UserSummary } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { plainText } from "../domain/markdown";
import { reportRepo, type ReportRow } from "../repositories/report.repository";
import { loadSummaries } from "./user.presenter";

interface Target {
  authorId: string;
  excerpt: string;
  status: "PUBLISHED" | "HIDDEN" | "DELETED";
  rating?: number;
}

async function loadTargets(rows: readonly ReportRow[], exec: Executor): Promise<Map<string, Target>> {
  const ids = (t: ReportRow["target_type"]) => [...new Set(rows.filter((r) => r.target_type === t).map((r) => r.target_id))];
  const [reviews, threads, replies] = await Promise.all([
    ids("REVIEW").length ? exec.selectFrom("reviews").select(["id", "user_id", "rating", "body", "status"]).where("id", "in", ids("REVIEW")).execute() : Promise.resolve([]),
    ids("QA_THREAD").length ? exec.selectFrom("qa_threads").select(["id", "author_id", "title", "body", "status"]).where("id", "in", ids("QA_THREAD")).execute() : Promise.resolve([]),
    ids("QA_REPLY").length ? exec.selectFrom("qa_replies").select(["id", "author_id", "body", "status"]).where("id", "in", ids("QA_REPLY")).execute() : Promise.resolve([]),
  ]);
  const out = new Map<string, Target>();
  for (const r of reviews) out.set(`REVIEW:${r.id}`, { authorId: r.user_id, excerpt: r.body ? plainText(r.body, 280) : `${r.rating} star rating`, status: r.status, rating: r.rating });
  for (const t of threads) out.set(`QA_THREAD:${t.id}`, { authorId: t.author_id, excerpt: plainText(`${t.title}: ${t.body}`, 280), status: t.status });
  for (const p of replies) out.set(`QA_REPLY:${p.id}`, { authorId: p.author_id, excerpt: plainText(p.body, 280), status: p.status });
  return out;
}

export async function presentReports(rows: readonly ReportRow[], exec: Executor = db): Promise<AdminReport[]> {
  if (!rows.length) return [];
  const courseIds = [...new Set(rows.map((r) => r.course_id).filter((x): x is string => !!x))];
  const [targets, counts, courses] = await Promise.all([
    loadTargets(rows, exec),
    reportRepo.openCounts(rows.map((r) => r.target_id), exec),
    courseIds.length ? exec.selectFrom("courses").select(["id", "slug", "title"]).where("id", "in", courseIds).execute() : Promise.resolve([]),
  ]);
  const people = await loadSummaries([...rows.map((r) => r.reporter_id), ...[...targets.values()].map((t) => t.authorId)], exec);
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const missing = (id: string): UserSummary => ({ id, username: "", displayName: "Former member", avatarUrl: null, headline: null, role: "LEARNER" });
  return rows.map((r) => {
    const key = `${r.target_type}:${r.target_id}`;
    const t = targets.get(key);
    const c = r.course_id ? courseById.get(r.course_id) : undefined;
    const open = counts.get(key) ?? 0;
    return {
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      course: c ? { id: c.id, slug: String(c.slug), title: c.title } : null,
      reporter: people.get(r.reporter_id) ?? missing(r.reporter_id),
      reason: r.reason,
      note: r.note,
      target: t ? { author: people.get(t.authorId) ?? null, excerpt: t.excerpt, status: t.status, ...(t.rating !== undefined ? { rating: t.rating } : {}) } : null,
      otherReports: Math.max(0, open - (r.status === "OPEN" ? 1 : 0)),
      status: r.status,
      resolution: r.resolution,
      createdAt: r.created_at.toISOString(),
    };
  });
}
