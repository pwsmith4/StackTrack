import { resolve } from "node:path";
import pg from "pg";
import type { EventLedger } from "@stacktrack/domain";
import { createApp } from "./app.js";
import { LocalFileEventLedger } from "./file-ledger.js";
import { localFixtures, seedLocalLedger } from "./local-fixtures.js";
import { PostgresEventLedger } from "./postgres-ledger.js";
import { PostgresDeviceAdministration, type DeviceAdministration } from "./device-administration.js";
import { PostgresAdminAccess } from "./admin-access.js";
import { PostgresReviewAdministration } from "./review-administration.js";
import { PostgresCorrectionAdministration } from "./correction-administration.js";
import { PostgresLocationAdministration } from "./location-administration.js";
import { PostgresContainerAdministration } from "./container-administration.js";
import { seedPostgres } from "./postgres-seed.js";

const { Pool } = pg;
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.LOCAL_HOST ?? "127.0.0.1";
const dataPath =
  process.env.LOCAL_DATA_PATH ?? resolve(process.cwd(), ".local-data", "ledger.json");
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://stacktrack:stacktrack@127.0.0.1:5433/stacktrack";

let ledger: EventLedger;
let referenceData:
  | ((tenantId: string) => ReturnType<PostgresEventLedger["referenceData"]>)
  | undefined;
let closeDatabase: (() => Promise<void>) | undefined;
let deviceAdministration: DeviceAdministration | undefined;
let locationAdministration: PostgresLocationAdministration | undefined;
let containerAdministration: PostgresContainerAdministration | undefined;
let adminAccess: PostgresAdminAccess | undefined;
let reviewAdministration: PostgresReviewAdministration | undefined;
let correctionAdministration: PostgresCorrectionAdministration | undefined;
let dataDescription: string;

try {
  const probe = new Pool({ connectionString: databaseUrl });
  await probe.query("SELECT 1");
  await probe.end();
  await seedPostgres();

  const pool = new Pool({ connectionString: databaseUrl });
  const postgresLedger = new PostgresEventLedger(pool);
  ledger = postgresLedger;
  referenceData = (tenantId) => postgresLedger.referenceData(tenantId);
  deviceAdministration = new PostgresDeviceAdministration(pool);
  locationAdministration = new PostgresLocationAdministration(pool);
  containerAdministration = new PostgresContainerAdministration(pool);
  adminAccess = new PostgresAdminAccess(pool, localFixtures.tenant.tenantId);
  reviewAdministration = new PostgresReviewAdministration(pool);
  correctionAdministration = new PostgresCorrectionAdministration(pool);
  closeDatabase = () => pool.end();
  dataDescription = "PostgreSQL at 127.0.0.1:5433/stacktrack";
} catch (error) {
  console.warn(
    `PostgreSQL is unavailable; using the JSON fallback. ${error instanceof Error ? error.message : String(error)}`
  );
  const fileLedger = new LocalFileEventLedger(dataPath);
  if (fileLedger.eventsForTenant(localFixtures.tenant.tenantId).length === 0) {
    seedLocalLedger((input, context, receivedAt) =>
      fileLedger.submit(input, context, receivedAt)
    );
  }
  ledger = fileLedger;
  dataDescription = `JSON fallback at ${dataPath}`;
}
const app = await createApp({
  ledger,
  localMode: true,
  ...(referenceData ? { referenceData } : {}),
  ...(deviceAdministration ? { deviceAdministration } : {}),
  ...(locationAdministration ? { locationAdministration } : {}),
  ...(containerAdministration ? { containerAdministration } : {}),
  ...(adminAccess ? { adminAccess } : {}),
  ...(reviewAdministration ? { reviewAdministration } : {}),
  ...(correctionAdministration ? { correctionAdministration } : {})
});
if (closeDatabase) {
  app.addHook("onClose", closeDatabase);
}

try {
  await app.listen({ port, host });
  console.log(`StackTrack API: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  console.log(`Local data: ${dataDescription}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
