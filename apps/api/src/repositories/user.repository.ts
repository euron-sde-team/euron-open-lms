/**
 * Users. Reads that feed DTOs select only the columns presenters need; `findAuthById`
 * is the one place that loads credentials.
 */
import type { Insertable, Selectable, Updateable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { UserRole } from "@open-lms/types";
import type { Users } from "../db/types";

export type UserRow = Selectable<Users>;

export interface SummaryRow {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  avatar_upload_id: string | null;
  headline: string | null;
}

export class UserRepository {
  findById(id: string, exec: Executor = db) {
    return exec.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findByEmail(email: string, exec: Executor = db) {
    return exec.selectFrom("users").selectAll().where("email", "=", email).executeTakeFirst();
  }

  findByUsername(username: string, exec: Executor = db) {
    return exec.selectFrom("users").selectAll().where("username", "=", username).executeTakeFirst();
  }

  findByLogin(login: string, exec: Executor = db) {
    const column = login.includes("@") ? "email" : "username";
    return exec.selectFrom("users").selectAll().where(column, "=", login).executeTakeFirst();
  }

  /** What every authenticated request needs: identity, status and token version. */
  findAuthById(id: string, exec: Executor = db) {
    return exec
      .selectFrom("users")
      .select(["id", "username", "display_name", "role", "status", "token_version", "suspended_until"])
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /** The person card: identity, photo and headline. */
  findSummaries(ids: readonly string[], exec: Executor = db): Promise<SummaryRow[]> {
    if (!ids.length) return Promise.resolve([]);
    return exec
      .selectFrom("users")
      .select(["id", "username", "display_name", "role", "avatar_upload_id", "headline"])
      .where("id", "in", [...new Set(ids)])
      .execute();
  }

  insert(row: Insertable<Users>, exec: Executor = db) {
    return exec.insertInto("users").values(row).returningAll().executeTakeFirstOrThrow();
  }

  update(id: string, patch: Updateable<Users>, exec: Executor = db) {
    return exec
      .updateTable("users")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  /** Accept a TOTP step only if it is newer than the last accepted one (no replay). */
  async consumeTotpStep(id: string, step: number, exec: Executor = db): Promise<boolean> {
    const res = await exec
      .updateTable("users")
      .set({ totp_last_step: step })
      .where("id", "=", id)
      .where((eb) => eb.or([eb("totp_last_step", "is", null), eb("totp_last_step", "<", step)]))
      .executeTakeFirst();
    return Number(res.numUpdatedRows) === 1;
  }

  bumpTokenVersion(id: string, exec: Executor = db) {
    return exec
      .updateTable("users")
      .set((eb) => ({ token_version: eb("token_version", "+", 1), updated_at: new Date() }))
      .where("id", "=", id)
      .returning("token_version")
      .executeTakeFirst();
  }

  touchLastSeen(id: string, exec: Executor = db) {
    return exec.updateTable("users").set({ last_seen_at: new Date() }).where("id", "=", id).execute();
  }

  countUsers(exec: Executor = db) {
    return exec
      .selectFrom("users")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.n));
  }
}

export const userRepo = new UserRepository();
