import pg from "pg";
import { createApp } from "./app.js";
import { PostgresEventLedger } from "./postgres-ledger.js";
import { PostgresDeviceAdministration } from "./device-administration.js";
import { PostgresAdminAccess } from "./admin-access.js";
import { PostgresReviewAdministration } from "./review-administration.js";
import { PostgresCorrectionAdministration } from "./correction-administration.js";

const { Pool } = pg;

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const databaseUrl = process.env.DATABASE_URL;
const testMode = process.env.STACKTRACK_TEST_MODE === "true";
const tenantId = process.env.STACKTRACK_TENANT_ID ?? "10000000-0000-4000-8000-000000000001";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required when running the cloud API.");
}

const pool = new Pool({ connectionString: databaseUrl });
await pool.query("SELECT 1");
const ledger = new PostgresEventLedger(pool);
const app = await createApp({
  ledger,
  // The current interfaces use development headers and local inspection routes.
  // Never enable this outside the synthetic Azure test environment.
  localMode: testMode,
  referenceData: (tenantId) => ledger.referenceData(tenantId),
  deviceAdministration: new PostgresDeviceAdministration(pool),
  adminAccess: new PostgresAdminAccess(pool, tenantId),
  reviewAdministration: new PostgresReviewAdministration(pool),
  correctionAdministration: new PostgresCorrectionAdministration(pool)
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
