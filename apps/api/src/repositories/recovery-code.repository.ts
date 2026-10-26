/** Two-factor recovery codes: stored as HMACs, each usable once (see security/totp.ts). */
import { db, type Executor } from "../db/kysely";

export class RecoveryCodeRepository {
  /** Replace every code of the user with these hashes. */
  async replace(userId: string, hashes: string[], exec: Executor = db): Promise<void> {
    await exec.deleteFrom("totp_recovery_codes").where("user_id", "=", userId).execute();
    if (hashes.length) await exec.insertInto("totp_recovery_codes").values(hashes.map((code_hash) => ({ user_id: userId, code_hash }))).execute();
  }

  /** Spend one code. True only for an unused code of this user; concurrent uses cannot both win. */
  async consume(userId: string, hash: string, exec: Executor = db): Promise<boolean> {
    const res = await exec
      .updateTable("totp_recovery_codes")
      .set({ used_at: new Date() })
      .where("user_id", "=", userId)
      .where("code_hash", "=", hash)
      .where("used_at", "is", null)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) === 1;
  }

  deleteAll(userId: string, exec: Executor = db) {
    return exec.deleteFrom("totp_recovery_codes").where("user_id", "=", userId).execute();
  }

  remaining(userId: string, exec: Executor = db): Promise<number> {
    return exec
      .selectFrom("totp_recovery_codes")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("user_id", "=", userId)
      .where("used_at", "is", null)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.n));
  }
}

export const recoveryCodeRepo = new RecoveryCodeRepository();
