/** Bundle writes and the admin bundle list (keyset by updated_at, id). */
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import { likeContains } from "../domain/search-text";
import { atKey, olderThan, type TimeKey } from "./keyset";

export class BundleAdminRepository {
  byId(id: string, exec: Executor = db) {
    return exec.selectFrom("bundles").selectAll().where("id", "=", id).executeTakeFirst();
  }

  list(f: { q?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED"; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = exec.selectFrom("bundles").selectAll().select(atKey("updated_at"));
    if (f.status) q = q.where("status", "=", f.status);
    if (f.q?.trim()) q = q.where(sql<boolean>`title ILIKE ${likeContains(f.q.trim())}`);
    return q.where(olderThan("updated_at", "id", f.cursor)).orderBy("updated_at", "desc").orderBy("id", "desc").limit(f.limit + 1).execute();
  }

  async replaceCourses(bundleId: string, courseIds: string[], trx: Executor): Promise<void> {
    await trx.deleteFrom("bundle_courses").where("bundle_id", "=", bundleId).execute();
    if (courseIds.length) await trx.insertInto("bundle_courses").values(courseIds.map((courseId, position) => ({ bundle_id: bundleId, course_id: courseId, position }))).execute();
  }

  async courseCount(bundleId: string, exec: Executor = db): Promise<number> {
    const r = await exec.selectFrom("bundle_courses").select((eb) => eb.fn.countAll<number>().as("n")).where("bundle_id", "=", bundleId).executeTakeFirstOrThrow();
    return Number(r.n);
  }
}

export const bundleAdminRepo = new BundleAdminRepository();
