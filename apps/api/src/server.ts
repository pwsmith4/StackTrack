import pg from "pg";
import { createApp } from "./app.js";
import { PostgresEventLedger } from "./postgres-ledger.js";
import { PostgresDeviceAdministration } from "./device-administration.js";

const { Pool } = pg;

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const databaseUrl = process.env.DATABASE_URL;
const testMode = process.env.STACKTRACK_TEST_MODE === "true";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required when running the cloud API.");
}

const pool = new Pool({ connectionString: databaseUrl });
await pool.query("SELECT 1");
const ledger = new PostgresEventLedger(pool);
const app = createApp({
  ledger,
  // The current interfaces use development headers and local inspection routes.
  // Never enable this outside the synthetic Azure test environment.
  localMode: testMode,
  referenceData: (tenantId) => ledger.referenceData(tenantId),
  deviceAdministration: new PostgresDeviceAdministration(pool)
});
app.addHook("onClose", () => pool.end());

try {
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`StackTrack API listening on port ${port}; test mode: ${testMode}`);
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}
