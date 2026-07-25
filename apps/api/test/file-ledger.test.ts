import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalFileEventLedger } from "../src/file-ledger.js";

const temporaryDirectories: string[] = [];
const tenantId = "10000000-0000-4000-8000-000000000001";
const deviceId = "30000000-0000-4000-8000-000000000001";
const containerId = "40000000-0000-4000-8000-000000000001";

function localEvent() {
  return {
    eventId: "70000000-0000-4000-8000-000000000001",
    deviceInstallationId: "31000000-0000-4000-8000-000000000001",
    deviceSequence: 0,
    containerId,
    loadCodeId: "50000000-0000-4000-8000-000000000001",
    locationId: "20000000-0000-4000-8000-000000000002",
    eventType: "load_assigned",
    eventAt: "2026-07-22T12:00:00.000Z"
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("LocalFileEventLedger", () => {
  it("preserves accepted evidence across a local server restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "stacktrack-local-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "ledger.json");
    const firstProcess = new LocalFileEventLedger(path);

    firstProcess.submit(
      localEvent(),
      { tenantId, deviceId },
      new Date("2026-07-22T12:00:01.000Z")
    );

    const restartedProcess = new LocalFileEventLedger(path);
    expect(restartedProcess.eventsForTenant(tenantId)).toHaveLength(1);
    expect(
      restartedProcess.projectionForContainer(tenantId, containerId)
    ).toMatchObject({ loadState: "loaded", health: "clean" });
  });

  it("persists a local reset", () => {
    const directory = mkdtempSync(join(tmpdir(), "stacktrack-local-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "ledger.json");
    const ledger = new LocalFileEventLedger(path);
    ledger.submit(
      localEvent(),
      { tenantId, deviceId },
      new Date("2026-07-22T12:00:01.000Z")
    );

    ledger.reset();

    expect(new LocalFileEventLedger(path).eventsForTenant(tenantId)).toHaveLength(0);
  });
});

