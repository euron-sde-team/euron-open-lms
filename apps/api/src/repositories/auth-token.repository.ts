import { db, type Executor } from "../db/kysely";

type TokenType = "VERIFY_EMAIL" | "RESET_PASSWORD";

export class AuthTokenRepository {
  insert(row: { id: string; user_id: string; type: TokenType; token_hash: string; expires_at: Date }, exec: Executor = db) {
    return exec.insertInto("auth_tokens").values(row).execute();
  }

  /** Atomically mark a valid token used and return its owner; null if missing, used or expired. */
  async consume(type: TokenType, tokenHash: string, exec: Executor = db): Promise<string | null> {
    const row = await exec
      .updateTable("auth_tokens")
      .set({ used_at: new Date() })
      .where("type", "=", type)
      .where("token_hash", "=", tokenHash)
      .where("used_at", "is", null)
      .where("expires_at", ">", new Date())
      .returning("user_id")
      .executeTakeFirst();
    return row?.user_id ?? null;
  }

  invalidateOutstanding(userId: string, type: TokenType, exec: Executor = db) {
    return exec.updateTable("auth_tokens").set({ used_at: new Date() }).where("user_id", "=", userId).where("type", "=", type).where("used_at", "is", null).execute();
  }
}

export const authTokenRepo = new AuthTokenRepository();
