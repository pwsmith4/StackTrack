import pg from "pg";
import { PostgresEventLedger } from "./postgres-ledger.js";

const { Pool } = pg;

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const APP_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://stacktrack:stacktrack@127.0.0.1:5432/stacktrack";
const ADMIN_DATABASE_URL =
  process.env.DATABASE_ADMIN_URL ??
  "postgres://postgres:stacktrack@127.0.0.1:5432/stacktrack";

function id(prefix: string, index: number): string {
  return `${prefix}000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const locations = [
  ["Auburn Boulevard Donation Xpress", "donation_express"],
  ["Midtown Store", "store_backroom"],
  ["South Sacramento Warehouse", "warehouse"],
  ["In Transit", "in_transit"],
  ["Folsom Store", "store_backroom"],
  ["Elk Grove Store", "store_backroom"],
  ["Roseville Store", "store_backroom"],
  ["Arden Donation Xpress", "donation_express"]
] as const;

const locationId = (index: number) => id("20", index);
const deviceId = (index: number) => id("30", index);
const installationId = (index: number) => id("31", index);
const containerId = (index: number) => id("40", index);
const eventId = (index: number) => id("51", index);
const loadCodeId = (index: number) => id("61", index);

interface SeedOptions {
  readonly reset?: boolean;
}

export async function seedPostgres(
  options: SeedOptions = {}
): Promise<{ containers: number; events: number; reviews: number }> {
  const admin = new Pool({ connectionString: ADMIN_DATABASE_URL });
  try {
    const exists = await admin.query(
      "SELECT 1 FROM tenants WHERE tenant_id = $1",
      [TENANT_ID]
    );
    if (exists.rowCount && !options.reset) {
      return await databaseCounts(admin);
    }

    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      if (options.reset) {
        await client.query(`
          TRUNCATE TABLE
            audit_log, correction_actions, correction_requests,
            review_case_actions, review_cases, asset_events, load_codes,
            goods_types, secondary_fields, containers, container_types,
            device_installations, devices, locations, tenants
          RESTART IDENTITY CASCADE
        `);
      }

      await client.query(
        `INSERT INTO tenants (tenant_id, tenant_slug, tenant_name)
         VALUES ($1, 'goodwill-local', 'Goodwill Sacramento — Simulation')`,
        [TENANT_ID]
      );

      for (const [index, [name, type]] of locations.entries()) {
        await client.query(
          `INSERT INTO locations
             (tenant_id, location_id, location_name, location_type)
           VALUES ($1,$2,$3,$4)`,
          [TENANT_ID, locationId(index + 1), name, type]
        );
      }

      // Preserve the pilot device IDs used by the mobile build:
      // device 1 = Midtown, device 2 = warehouse.
      const physicalLocations = [2, 3, 1, 5, 6, 7, 8];
      for (const [index, assignedLocation] of physicalLocations.entries()) {
        const number = index + 1;
        const locationName = locations[assignedLocation - 1]![0];
        await client.query(
          `INSERT INTO devices
             (tenant_id, device_id, device_label, assigned_location_id)
           VALUES ($1,$2,$3,$4)`,
          [
            TENANT_ID,
            deviceId(number),
            `Shared scanner ${number} — ${locationName}`,
            locationId(assignedLocation)
          ]
        );
        await client.query(
          `INSERT INTO device_installations
             (tenant_id, device_id, installation_id, last_authenticated_at)
           VALUES ($1,$2,$3,clock_timestamp())`,
          [TENANT_ID, deviceId(number), installationId(number)]
        );
      }

      const types = [
        [id("41", 1), "bin"],
        [id("41", 2), "cart"],
        [id("41", 3), "gaylord"]
      ] as const;
      for (const [typeId, name] of types) {
        await client.query(
          `INSERT INTO container_types
             (tenant_id, container_type_id, type_name)
           VALUES ($1,$2,$3)`,
          [TENANT_ID, typeId, name]
        );
      }

      const containerLabels = [
        ...Array.from({ length: 60 }, (_, index) => `B${1001 + index}`),
        ...Array.from({ length: 35 }, (_, index) => `C${2001 + index}`),
        ...Array.from({ length: 25 }, (_, index) => `G${3001 + index}`)
      ];
      for (const [index, label] of containerLabels.entries()) {
        const typeIndex = label.startsWith("B") ? 1 : label.startsWith("C") ? 2 : 3;
        await client.query(
          `INSERT INTO containers
             (tenant_id, container_id, container_label, container_type_id)
           VALUES ($1,$2,$3,$4)`,
          [TENANT_ID, containerId(index + 1), label, id("41", typeIndex)]
        );
      }

      const fields = [
        [id("42", 1), "Quality Type", ["Raw", "Pre-Sort", "Salvage"], true],
        [id("42", 2), "Other Type", ["Trash", "Ecomm", "Ewaste", "Bric Brac"], false]
      ] as const;
      for (const [fieldId, name, values, salvage] of fields) {
        await client.query(
          `INSERT INTO secondary_fields
             (tenant_id, secondary_field_id, secondary_field_name, options,
              contains_salvage)
           VALUES ($1,$2,$3,$4,$5)`,
          [TENANT_ID, fieldId, name, JSON.stringify(values), salvage]
        );
      }
      for (const [index, name] of ["Soft", "Hard", "Books", "Other"].entries()) {
        await client.query(
          `INSERT INTO goods_types
             (tenant_id, goods_type_id, goods_type_name, secondary_field_id,
              sort_order)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            TENANT_ID,
            id("43", index + 1),
            name,
            name === "Other" ? id("42", 2) : id("42", 1),
            index + 1
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await admin.end();
  }

  const applicationPool = new Pool({ connectionString: APP_DATABASE_URL });
  const ledger = new PostgresEventLedger(applicationPool);
  try {
    const now = new Date();
    const sourceLocations = [1, 2, 5, 6, 7, 8];
    const locationDevice = new Map([
      [1, 3],
      [2, 1],
      [3, 2],
      [5, 4],
      [6, 5],
      [7, 6],
      [8, 7]
    ]);
    const sequences = new Map<number, number>();
    let nextEvent = 1;
    let nextLoad = 1;
    const hoursAgo = (hours: number) =>
      new Date(now.getTime() - hours * 3_600_000).toISOString();
    const referenceVersion = hoursAgo(72);
    const goods = [
      ["Soft", "Raw"],
      ["Hard", "Pre-Sort"],
      ["Books", "Salvage"],
      ["Other", "Ecomm"]
    ] as const;

    const submit = async (
      containerNumber: number,
      locationNumber: number,
      eventType: "load_assigned" | "batch_out" | "batch_in" | "emptied",
      ageHours: number,
      loadNumber: number | null,
      payload: Record<string, unknown>,
      deviceOverride?: number,
      clockOffset = 0
    ) => {
      const deviceNumber =
        deviceOverride ?? locationDevice.get(locationNumber) ?? 2;
      const sequence = sequences.get(deviceNumber) ?? 0;
      sequences.set(deviceNumber, sequence + 1);
      const observed = hoursAgo(ageHours);
      const input = {
        eventId: eventId(nextEvent++),
        deviceInstallationId: installationId(deviceNumber),
        deviceSequence: sequence,
        containerId: containerId(containerNumber),
        ...(loadNumber ? { loadCodeId: loadCodeId(loadNumber) } : {}),
        locationId: locationId(locationNumber),
        eventType,
        eventAt: observed,
        deviceClockOffsetSeconds: clockOffset,
        clockVerifiedAt: hoursAgo(Math.max(0, ageHours + 0.1)),
        referenceDataVersion:
          containerNumber % 29 === 0 ? hoursAgo(240) : referenceVersion,
        payload
      };
      const result = await ledger.submit(
        input,
        { tenantId: TENANT_ID, deviceId: deviceId(deviceNumber) },
        new Date(Date.parse(observed) + 20_000)
      );
      if (!result.accepted) {
        throw new Error(`Seed event rejected: ${result.message}`);
      }
    };

    for (let containerNumber = 1; containerNumber <= 120; containerNumber++) {
      if (containerNumber === 4) continue; // B1004 remains unused for manual tests.
      const source =
        containerNumber === 1
          ? 2
          : sourceLocations[(containerNumber - 1) % sourceLocations.length]!;
      const sourceDevice = locationDevice.get(source)!;
      const baseAge = 4 + (containerNumber % 12) * 7;
      const scenario = containerNumber === 1 ? 1 : containerNumber % 6;
      if (scenario === 4) continue;

      const goodsValue = goods[containerNumber % goods.length]!;
      const loadNumber = nextLoad++;
      const loadPayload = {
        displayLoadCode: `ST-${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(loadNumber).padStart(4, "0")}`,
        goodsType: goodsValue[0],
        secondaryValue: goodsValue[1]
      };
      const reviewClock = containerNumber === 58 ? 90_000 : 0;
      await submit(
        containerNumber,
        source,
        "load_assigned",
        baseAge + 3,
        loadNumber,
        loadPayload,
        sourceDevice,
        reviewClock
      );

      if ([1, 2, 3, 5].includes(scenario)) {
        await submit(
          containerNumber,
          4,
          "batch_out",
          baseAge + 2,
          loadNumber,
          { sourceLocationId: locationId(source), destinationLocationId: locationId(3) },
          sourceDevice
        );
      }
      if ([2, 3, 5].includes(scenario)) {
        await submit(
          containerNumber,
          3,
          "batch_in",
          baseAge + 1,
          loadNumber,
          { sourceLocationId: locationId(source) },
          3
        );
      }
      if ([3, 5].includes(scenario)) {
        await submit(containerNumber, 3, "emptied", baseAge, null, {}, 3);
      }
      if (scenario === 5) {
        const secondLoad = nextLoad++;
        const secondGoods = goods[(containerNumber + 1) % goods.length]!;
        await submit(
          containerNumber,
          source,
          "load_assigned",
          Math.max(0.5, baseAge - 0.5),
          secondLoad,
          {
            displayLoadCode: `ST-${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(secondLoad).padStart(4, "0")}`,
            goodsType: secondGoods[0],
            secondaryValue: secondGoods[1]
          },
          sourceDevice
        );
      }
    }

    // C2002 deliberately receives a second load assignment before being emptied.
    const conflictContainer = 62;
    for (const secondary of [0, 1]) {
      const loadNumber = nextLoad++;
      await submit(
        conflictContainer,
        2,
        "load_assigned",
        1.5 - secondary * 0.1,
        loadNumber,
        {
          displayLoadCode: `ST-REVIEW-${secondary + 1}`,
          goodsType: "Soft",
          secondaryValue: secondary ? "Pre-Sort" : "Raw"
        },
        2
      );
    }
  } finally {
    await applicationPool.end();
  }

  const finalPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  try {
    return await databaseCounts(finalPool);
  } finally {
    await finalPool.end();
  }
}

async function databaseCounts(pool: pg.Pool) {
  const result = await pool.query<{
    containers: string;
    events: string;
    reviews: string;
  }>(
    `SELECT
       (SELECT count(*) FROM containers WHERE tenant_id = $1) AS containers,
       (SELECT count(*) FROM asset_events WHERE tenant_id = $1) AS events,
       (SELECT count(*) FROM review_cases WHERE tenant_id = $1) AS reviews`,
    [TENANT_ID]
  );
  return {
    containers: Number(result.rows[0]?.containers ?? 0),
    events: Number(result.rows[0]?.events ?? 0),
    reviews: Number(result.rows[0]?.reviews ?? 0)
  };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  const reset = process.argv.includes("--reset");
  const counts = await seedPostgres({ reset });
  console.log(
    `PostgreSQL simulation ready: ${counts.containers} containers, ${counts.events} events, ${counts.reviews} stored review cases.`
  );
}
