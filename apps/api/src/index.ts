/**
 * API process: the HTTP server.
 *
 * Boot order: validate config, (optionally) migrate, register job handlers that the
 * inline mode needs, start listening. SIGTERM drains: stop accepting,
 * finish in-flight requests, close pools.
 */
process.env.TZ = "UTC";

import http from "node:http";
import { createApp } from "./app";
import { assertProductionConfig, productionWarnings, config } from "./core/config";
import { captureError, logger } from "./core/logger";
import { closeRedis } from "./integrations/redis";
import { closeQueues } from "./jobs/registry";
import { closeDb, initDbTypes } from "./db/kysely";
import { registerAllJobs } from "./jobs";

async function main(): Promise<void> {
  for (const problem of assertProductionConfig()) logger.warn(`config: ${problem}`);
  for (const warning of productionWarnings()) logger.warn(`config: ${warning}`);
  if (config.MIGRATE_ON_BOOT) {
    const { migrate } = await import("../../../db/migrate");
    await migrate({ log: (line: string) => logger.info(line.trim()) });
  }
  await initDbTypes();
  registerAllJobs();

  const app = createApp();
  const server = http.createServer(app);

  server.listen(config.PORT, () => logger.info({ port: config.PORT }, "api listening"));

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    const force = setTimeout(() => process.exit(1), 25_000);
    force.unref();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeQueues();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

process.on("unhandledRejection", (err) => captureError(err, { where: "unhandledRejection" }));

main().catch((err) => {
  captureError(err, { where: "boot" });
  process.exit(1);
});
