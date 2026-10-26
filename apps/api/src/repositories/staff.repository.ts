/**
 * Staff accounts (any role but LEARNER; users_staff_idx covers the role filter) with how
 * many courses each is on, counted in one grouped query per page.
 */
import type { UserRole } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { atKey, olderThan, type TimeKey } from "./keyset";
import { userNameLike } from "./text-search";

export class StaffRepository {
  list(q: { role?: Exclude<UserRole, "LEARNER">; q?: string; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let query = exec.selectFrom("users as u").select(["u.id", atKey("u.created_at")]).where("u.role", "<>", "LEARNER");
    if (q.role) query = query.where("u.role", "=", q.role);
    if (q.q) query = query.where(userNameLike("u", q.q));
    return query.where(olderThan("u.created_at", "u.id", q.cursor)).orderBy("u.created_at", "desc").orderBy("u.id", "desc").limit(q.limit + 1).execute();
  }

  rows(ids: readonly string[], exec: Executor = db) {
    if (!ids.length) return Promise.resolve([]);
    return exec
      .selectFrom("users as u")
      .select(["u.id", "u.email", "u.status", "u.role", "u.created_at", (eb) => eb.selectFrom("course_staff as s").select((x) => x.fn.countAll<string>().as("n")).whereRef("s.user_id", "=", "u.id").as("course_count")])
      .where("u.id", "in", [...new Set(ids)])
      .execute();
  }
}

export const staffRepo = new StaffRepository();
