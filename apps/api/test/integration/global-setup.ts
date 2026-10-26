/** Recreate the test database schema and apply every migration, once per run. */
import pg from "pg";
import { testDatabaseUrl } from "./guard";

export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const target = new URL(url);
  const name = target.pathname.replace(/^\//, "");
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
  process.env.DATABASE_URL = url;
  const { migrate } = await import("../../../../db/migrate");
  await migrate({ log: () => undefined });
}
