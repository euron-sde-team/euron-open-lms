import { db, type Executor } from "../db/kysely";

export class SessionRepository {
  insert(
    row: { id: string; user_id: string; family_id: string; token_hash: string; user_agent: string | null; ip: string | null; expires_at: Date },
    exec: Executor = db,
  ) {
    return exec.insertInto("sessions").values(row).execute();
  }

  findByHash(tokenHash: string, exec: Executor = db) {
    return exec.selectFrom("sessions").selectAll().where("token_hash", "=", tokenHash).executeTakeFirst();
  }

  /** Mark a session rotated. Returns false if it was already revoked (a concurrent refresh or a replay). */
  async rotate(id: string, replacedBy: string, exec: Executor = db): Promise<boolean> {
    const res = await exec
      .updateTable("sessions")
      .set({ revoked_at: new Date(), replaced_by: replacedBy, last_used_at: new Date() })
      .where("id", "=", id)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) === 1;
  }

  revoke(id: string, exec: Executor = db) {
    return exec.updateTable("sessions").set({ revoked_at: new Date() }).where("id", "=", id).where("revoked_at", "is", null).execute();
  }

  revokeFamily(familyId: string, exec: Executor = db) {
    return exec.updateTable("sessions").set({ revoked_at: new Date() }).where("family_id", "=", familyId).where("revoked_at", "is", null).execute();
  }

  revokeAllForUser(userId: string, exec: Executor = db) {
    return exec.updateTable("sessions").set({ revoked_at: new Date() }).where("user_id", "=", userId).where("revoked_at", "is", null).execute();
  }

  listActive(userId: string, exec: Executor = db) {
    return exec
      .selectFrom("sessions")
      .select(["id", "family_id", "user_agent", "ip", "created_at", "last_used_at", "expires_at"])
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", new Date())
      .orderBy("last_used_at", "desc")
      .execute();
  }
}

export const sessionRepo = new SessionRepository();
