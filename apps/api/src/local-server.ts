import { resolve } from "node:path";
import pg from "pg";
import type { EventLedger } from "@stacktrack/domain";
import { createApp } from "./app.js";
import { LocalFileEventLedger } from "./file-ledger.js";
import { localFixtures, seedLocalLedger } from "./local-fixtures.js";
import { PostgresEventLedger } from "./postgres-ledger.js";
import { seedPostgres } from "./postgres-seed.js";

const { Pool } = pg;
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.LOCAL_HOST ?? "127.0.0.1";
const dataPath =
  process.env.LOCAL_DATA_PATH ?? resolve(process.cwd(), ".local-data", "ledger.json");
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://stacktrack:stacktrack@127.0.0.1:5432/stacktrack";

let ledger: EventLedger;
let referenceData:
  | ((tenantId: string) => ReturnType<PostgresEventLedger["referenceData"]>)
  | undefined;
let closeDatabase: (() => Promise<void>) | undefined;
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
  closeDatabase = () => pool.end();
  dataDescription = "PostgreSQL at 127.0.0.1:5432/stacktrack";
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
const app = createApp({
  ledger,
  localMode: true,
  ...(referenceData ? { referenceData } : {})
});
if (closeDatabase) {
  app.addHook("onClose", closeDatabase);
}

try {
  await app.listen({ port, host });
  console.log(`StackTrack Local Lab: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  console.log(`Local data: ${dataDescription}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
