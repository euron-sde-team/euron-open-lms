/** The category taxonomy, ordered by `position`, with how many courses each holds. */
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  position: number;
  course_count: number;
}

export class CategoryRepository {
  list(exec: Executor = db): Promise<CategoryRow[]> {
    return exec
      .selectFrom("categories as c")
      .select((eb) => [
        "c.id",
        "c.slug",
        "c.name",
        "c.description",
        "c.position",
        eb.selectFrom("course_categories as cc").select((e) => e.fn.countAll<number>().as("n")).whereRef("cc.category_id", "=", "c.id").as("course_count"),
      ])
      .orderBy("c.position")
      .orderBy("c.name")
      .execute() as Promise<CategoryRow[]>;
  }

  async find(id: string, exec: Executor = db): Promise<CategoryRow | undefined> {
    return (await this.list(exec)).find((c) => c.id === id);
  }

  async existing(ids: readonly string[], exec: Executor = db): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await exec.selectFrom("categories").select("id").where("id", "in", [...new Set(ids)]).execute();
    return new Set(rows.map((r) => r.id));
  }

  async slugsLike(base: string, exceptId: string | null, exec: Executor = db): Promise<string[]> {
    let q = exec.selectFrom("categories").select("slug").where((eb) => eb.or([eb("slug", "=", base), eb(sql<string>`slug::text`, "~", `^${base}-[0-9]+$`)]));
    if (exceptId) q = q.where("id", "<>", exceptId);
    return (await q.execute()).map((r) => r.slug);
  }

  async count(exec: Executor = db): Promise<number> {
    const r = await exec.selectFrom("categories").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async nextPosition(exec: Executor = db): Promise<number> {
    const r = await exec.selectFrom("categories").select((eb) => eb.fn.max<number | null>("position").as("p")).executeTakeFirst();
    return r?.p === null || r?.p === undefined ? 0 : Number(r.p) + 1;
  }

  insert(row: { id: string; slug: string; name: string; description: string | null; position: number }, exec: Executor = db) {
    return exec.insertInto("categories").values(row).execute();
  }

  update(id: string, patch: { slug?: string; name?: string; description?: string | null }, exec: Executor = db) {
    return exec.updateTable("categories").set(patch).where("id", "=", id).executeTakeFirst();
  }

  delete(id: string, exec: Executor = db) {
    return exec.deleteFrom("categories").where("id", "=", id).executeTakeFirst();
  }

  async setPositions(ids: readonly string[], trx: Executor): Promise<void> {
    if (!ids.length) return;
    const values = sql.join(ids.map((id, i) => sql`(${id}, ${i}::int)`));
    await sql`UPDATE categories t SET position = v.pos FROM (VALUES ${values}) AS v(id, pos) WHERE t.id = v.id`.execute(trx);
  }

  /** Serialise taxonomy writes (slug picks, reorders) across API tasks. */
  async lockTaxonomy(trx: Executor): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtext('categories'))`.execute(trx);
  }
}

export const categoryRepo = new CategoryRepository();
