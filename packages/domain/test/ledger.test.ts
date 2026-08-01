import { describe, expect, it } from "vitest";
import { InMemoryEventLedger } from "../src/index.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const secondDeviceId = "22222222-2222-4222-8222-222222222223";
const installationId = "33333333-3333-4333-8333-333333333333";
const secondInstallationId = "33333333-3333-4333-8333-333333333334";
const containerId = "44444444-4444-4444-8444-444444444444";
const loadCodeId = "55555555-5555-4555-8555-555555555555";
const locationId = "66666666-6666-4666-8666-666666666666";
const secondLocationId = "66666666-6666-4666-8666-666666666667";

function loadAssigned(
  eventId = "77777777-7777-4777-8777-777777777777",
  overrides: Record<string, unknown> = {}
) {
  return {
    eventId,
    deviceInstallationId: installationId,
    deviceSequence: 0,
    containerId,
    loadCodeId,
    locationId,
    eventType: "load_assigned",
    eventAt: "2026-07-22T12:00:00.000Z",
    payload: { note: "baseline" },
    ...overrides
  };
}

describe("InMemoryEventLedger", () => {
  it("accepts an exact replay without writing another event", () => {
    const ledger = new InMemoryEventLedger();
    const now = new Date("2026-07-22T12:00:01.000Z");

    const first = ledger.submit(loadAssigned(), { tenantId, deviceId }, now);
    const duplicate = ledger.submit(
      loadAssigned(undefined, { payload: { note: "baseline" } }),
      { tenantId, deviceId },
      now
    );

    expect(first.status).toBe("accepted");
    expect(duplicate.status).toBe("duplicate");
    expect(ledger.eventsForContainer(tenantId, containerId)).toHaveLength(1);
  });

  it("rejects reuse of an event UUID with changed evidence", () => {
    const ledger = new InMemoryEventLedger();
    const now = new Date("2026-07-22T12:00:01.000Z");

    ledger.submit(loadAssigned(), { tenantId, deviceId }, now);
    const mismatch = ledger.submit(
      loadAssigned(undefined, { locationId: secondLocationId }),
      { tenantId, deviceId },
      now
    );

    expect(mismatch.accepted).toBe(false);
    expect(mismatch.errorCode).toBe("IdempotencyKeyMismatch");
  });

  it("rejects a duplicate human-facing load code across device events", () => {
    const ledger = new InMemoryEventLedger();
    const now = new Date("2026-07-22T12:00:01.000Z");

    ledger.submit(
      loadAssigned(undefined, {
        payload: { displayLoadCode: "ST-0722-ABC12345" }
      }),
      { tenantId, deviceId },
      now
    );
    const collision = ledger.submit(
      loadAssigned("77777777-7777-4777-8777-777777777799", {
        containerId: "44444444-4444-4444-8444-444444444445",
        loadCodeId: "55555555-5555-4555-8555-555555555599",
        deviceInstallationId: secondInstallationId,
        payload: { displayLoadCode: "st-0722-abc12345" }
      }),
      { tenantId, deviceId: secondDeviceId },
      now
    );

    expect(collision.accepted).toBe(false);
    expect(collision.errorCode).toBe("InvalidPayload");
    expect(collision.message).toContain("already assigned");
  });

  it("preserves a contradictory double-load and puts it in review", () => {
    const ledger = new InMemoryEventLedger();
    ledger.submit(
      loadAssigned(),
      { tenantId, deviceId },
      new Date("2026-07-22T12:00:01.000Z")
    );

    const conflict = ledger.submit(
      loadAssigned("77777777-7777-4777-8777-777777777778", {
        loadCodeId: "55555555-5555-4555-8555-555555555556",
        deviceInstallationId: secondInstallationId,
        eventAt: "2026-07-22T12:01:00.000Z"
      }),
      { tenantId, deviceId: secondDeviceId },
      new Date("2026-07-22T12:01:01.000Z")
    );

    const state = ledger.projectionForContainer(tenantId, containerId);
    expect(conflict.status).toBe("accepted_for_review");
    expect(ledger.eventsForContainer(tenantId, containerId)).toHaveLength(2);
    expect(state?.activeLoadCodeId).toBe(loadCodeId);
    expect(state?.health).toBe("needs_review");
    expect(state?.conflicts[0]?.reason).toBe("ContainerAlreadyLoaded");
  });

  it("flags a late offline arrival while reconstructing logical event order", () => {
    const ledger = new InMemoryEventLedger();
    ledger.submit(
      loadAssigned(undefined, {
        eventAt: "2026-07-22T12:10:00.000Z",
        deviceSequence: 1
      }),
      { tenantId, deviceId },
      new Date("2026-07-22T12:10:05.000Z")
    );

    const late = ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777779",
        deviceInstallationId: installationId,
        deviceSequence: 0,
        containerId,
        locationId,
        eventType: "batch_out",
        eventAt: "2026-07-22T12:05:00.000Z"
      },
      { tenantId, deviceId },
      new Date("2026-07-22T12:11:00.000Z")
    );

    expect(late.accepted).toBe(true);
    expect(late.warnings).toContain("LateArrival");
    expect(late.warnings).toContain("DeviceSequenceOutOfOrder");
  });

  it("requires review for an extreme device clock difference", () => {
    const ledger = new InMemoryEventLedger();
    const result = ledger.submit(
      loadAssigned(undefined, {
        deviceClockOffsetSeconds: 25 * 60 * 60,
        clockVerifiedAt: "2026-07-22T12:00:00.000Z"
      }),
      { tenantId, deviceId },
      new Date("2026-07-22T12:00:01.000Z")
    );

    expect(result.status).toBe("accepted_for_review");
    expect(result.warnings).toContain("ClockSkewReview");
    expect(ledger.reviewQueue(tenantId)).toHaveLength(1);
  });

  it("does not accept a planned receiving site in an event payload", () => {
    const ledger = new InMemoryEventLedger();
    const result = ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777780",
        deviceInstallationId: installationId,
        deviceSequence: 1,
        containerId,
        locationId,
        eventType: "batch_out",
        eventAt: "2026-07-22T12:05:00.000Z",
        payload: {
          sourceLocationId: locationId,
          destinationLocationId: secondLocationId
        }
      },
      { tenantId, deviceId },
      new Date("2026-07-22T12:05:01.000Z")
    );

    expect(result.accepted).toBe(false);
    expect(result.errorCode).toBe("InvalidPayload");
    expect(result.message).toContain("receiving site");
  });

  it("uses the arrival event location instead of a destination payload", () => {
    const ledger = new InMemoryEventLedger();
    const result = ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777781",
        deviceInstallationId: installationId,
        deviceSequence: 2,
        containerId,
        locationId: secondLocationId,
        eventType: "batch_in",
        eventAt: "2026-07-22T12:06:00.000Z",
        payload: { destinationLocationId: secondLocationId }
      },
      { tenantId, deviceId },
      new Date("2026-07-22T12:06:01.000Z")
    );

    expect(result.accepted).toBe(false);
    expect(result.errorCode).toBe("InvalidPayload");
    expect(result.message).toContain("arrival scan");
  });

  it("does not confuse legitimate offline time with clock skew", () => {
    const ledger = new InMemoryEventLedger();
    const result = ledger.submit(
      loadAssigned(),
      { tenantId, deviceId },
      new Date("2026-07-22T20:00:00.000Z")
    );

    expect(result.warnings).not.toContain("ClockSkewWarning");
    expect(result.status).toBe("accepted");
  });
});
