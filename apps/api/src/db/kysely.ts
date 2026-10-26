/**
 * The one database connection pool, and the `Executor` type every repository method
 * accepts so it can run inside or outside a transaction:
 *
 *   async findById(id: string, exec: Executor = db) { return exec.selectFrom("users")... }
 */
import { Kysely, PostgresDialect, type Transaction } from "kysely";
import pg from "pg";
import { config } from "../core/config";
import { resolveConnectionConfig } from "./connection-config";
import type { DB } from "./types";

// timestamp without time zone is never used by the schema, but parse it as UTC anyway.
pg.types.setTypeParser(1114, (v: string) => new Date(`${v}Z`));
// int8 (bigint): money in minor units, file sizes and COUNT(*). Safe as numbers well below 2^53.
pg.types.setTypeParser(20, (v: string) => Number(v));
// numeric: averages and ratios.
pg.types.setTypeParser(1700, (v: string) => Number(v));

/**
 * citext[] and arrays of our enums have no built-in parser (text[] columns such as
 * courses.outcomes and questions.tags do), and their type OIDs
 * are assigned per database when the extension and the enums are created, so they are
 * looked up once at boot (initDbTypes) and parsed like text[]. Without this they arrive
 * as the literal string "{A,B}". Every entry point awaits initDbTypes() before
 * its first query: index.ts, worker.ts, cli.ts and the test harness.
 */
let textArrayOids: Set<number> | null = null;
/** text[] (OID 1009): citext[] values are text arrays on the wire. */
const textArray = pg.types.getTypeParser(1009 as Parameters<typeof pg.types.getTypeParser>[0]);
const types = {
  getTypeParser: ((oid: number, format?: "text" | "binary") => (textArrayOids?.has(oid) ? textArray : pg.types.getTypeParser(oid, format as "text"))) as typeof pg.types.getTypeParser,
};

export const pool = new pg.Pool({
  ...resolveConnectionConfig(process.env),
  types,
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

export type Executor = Kysely<DB> | Transaction<DB>;

export async function initDbTypes(): Promise<void> {
  if (textArrayOids !== null) return;
  const r = await pool.query<{ oid: number }>("SELECT to_regtype('citext[]')::oid AS oid UNION SELECT typarray AS oid FROM pg_type WHERE typtype = 'e' AND typarray <> 0");
  textArrayOids = new Set(r.rows.filter((x) => x.oid).map((x) => Number(x.oid)));
}

export async function closeDb(): Promise<void> {
  await db.destroy();
}
