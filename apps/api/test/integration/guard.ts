/** Refuse to run against anything that is not obviously a disposable test database. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL (for example postgres://lms:lms@localhost:5492/lms_test)");
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) throw new Error(`TEST_DATABASE_URL must name a database ending in _test (got "${name}")`);
  return url;
}

export function testRedisUrl(): string {
  return process.env.TEST_REDIS_URL || "redis://localhost:6429/1";
}
