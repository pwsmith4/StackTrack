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
  const { payload: overridePayload, ...otherOverrides } = overrides;
  return {
    eventId,
    deviceInstallationId: installationId,
    deviceSequence: 0,
    containerId,
    loadCodeId,
    locationId,
    eventType: "load_assigned",
    eventAt: "2026-07-22T12:00:00.000Z",
    payload: {
      goodsType: "Soft",
      secondaryValue: "Raw",
      note: "baseline",
      ...(overridePayload && typeof overridePayload === "object" ? overridePayload : {})
    },
    ...otherOverrides
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

  it("rejects an incomplete load-code classification", () => {
    const ledger = new InMemoryEventLedger();
    const result = ledger.submit(
      loadAssigned(undefined, { payload: { goodsType: "Soft", secondaryValue: "" } }),
      { tenantId, deviceId },
      new Date("2026-07-22T12:00:01.000Z")
    );

    expect(result.accepted).toBe(false);
    expect(result.errorCode).toBe("InvalidPayload");
    expect(result.message).toContain("secondaryValue");
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

  it("preserves an arrival at a new site when no departure scan was recorded", () => {
    const ledger = new InMemoryEventLedger();
    ledger.submit(
      loadAssigned(undefined, { eventAt: "2026-07-22T12:00:00.000Z" }),
      { tenantId, deviceId },
      new Date("2026-07-22T12:00:01.000Z")
    );

    const arrival = ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777783",
        deviceInstallationId: secondInstallationId,
        deviceSequence: 0,
        containerId,
        locationId: secondLocationId,
        eventType: "batch_in",
        eventAt: "2026-07-22T13:00:00.000Z",
        payload: {}
      },
      { tenantId, deviceId: secondDeviceId },
      new Date("2026-07-22T13:00:01.000Z")
    );

    expect(arrival.accepted).toBe(true);
    expect(arrival.status).toBe("accepted_for_review");
    expect(arrival.warnings).toContain("LocationChangeWithoutDeparture");
    const projection = ledger.projectionForContainer(tenantId, containerId);
    expect(projection?.locationId).toBe(secondLocationId);
    expect(projection?.health).toBe("needs_review");
    expect(projection?.conflicts[0]?.reason).toBe("LocationChangeWithoutDeparture");
  });

  it("does not flag a normal arrival after a recorded departure", () => {
    const ledger = new InMemoryEventLedger();
    ledger.submit(
      loadAssigned(undefined, { eventAt: "2026-07-22T12:00:00.000Z" }),
      { tenantId, deviceId },
      new Date("2026-07-22T12:00:01.000Z")
    );
    ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777784",
        deviceInstallationId: installationId,
        deviceSequence: 1,
        containerId,
        locationId: secondLocationId,
        eventType: "batch_out",
        eventAt: "2026-07-22T12:30:00.000Z",
        payload: { sourceLocationId: locationId }
      },
      { tenantId, deviceId },
      new Date("2026-07-22T12:30:01.000Z")
    );
    const arrival = ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777785",
        deviceInstallationId: secondInstallationId,
        deviceSequence: 0,
        containerId,
        locationId: secondLocationId,
        eventType: "batch_in",
        eventAt: "2026-07-22T13:00:00.000Z",
        payload: {}
      },
      { tenantId, deviceId: secondDeviceId },
      new Date("2026-07-22T13:00:01.000Z")
    );

    expect(arrival.status).toBe("accepted");
    expect(arrival.warnings).not.toContain("LocationChangeWithoutDeparture");
  });

  it("flags a second departure before the prior movement is received", () => {
    const ledger = new InMemoryEventLedger();
    ledger.submit(
      loadAssigned(undefined, { eventAt: "2026-07-22T12:00:00.000Z" }),
      { tenantId, deviceId },
      new Date("2026-07-22T12:00:01.000Z")
    );
    ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777788",
        deviceInstallationId: installationId,
        deviceSequence: 1,
        containerId,
        locationId,
        eventType: "batch_out",
        eventAt: "2026-07-22T12:30:00.000Z",
        payload: { sourceLocationId: locationId }
      },
      { tenantId, deviceId },
      new Date("2026-07-22T12:30:01.000Z")
    );

    const repeatedDeparture = ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777789",
        deviceInstallationId: installationId,
        deviceSequence: 2,
        containerId,
        locationId,
        eventType: "batch_out",
        eventAt: "2026-07-22T13:00:00.000Z",
        payload: { sourceLocationId: locationId }
      },
      { tenantId, deviceId },
      new Date("2026-07-22T13:00:01.000Z")
    );

    expect(repeatedDeparture.status).toBe("accepted_for_review");
    expect(repeatedDeparture.warnings).toContain("RepeatedDepartureBeforeArrival");
    expect(
      ledger.projectionForContainer(tenantId, containerId)?.conflicts.map((item) => item.reason)
    ).toContain("RepeatedDepartureBeforeArrival");
  });

  it("uses a later load scan as location evidence when the departure was missed", () => {
    const ledger = new InMemoryEventLedger();
    ledger.submit(
      loadAssigned(undefined, { eventAt: "2026-07-22T12:00:00.000Z" }),
      { tenantId, deviceId },
      new Date("2026-07-22T12:00:01.000Z")
    );

    const movedLoad = ledger.submit(
      loadAssigned("77777777-7777-4777-8777-777777777786", {
        deviceInstallationId: secondInstallationId,
        deviceSequence: 0,
        locationId: secondLocationId,
        loadCodeId: "55555555-5555-4555-8555-555555555556",
        eventAt: "2026-07-22T13:00:00.000Z"
      }),
      { tenantId, deviceId: secondDeviceId },
      new Date("2026-07-22T13:00:01.000Z")
    );

    expect(movedLoad.status).toBe("accepted_for_review");
    expect(movedLoad.warnings).toContain("LocationChangeWithoutDeparture");
    const projection = ledger.projectionForContainer(tenantId, containerId);
    expect(projection?.locationId).toBe(secondLocationId);
    expect(projection?.activeLoadCodeId).toBe("55555555-5555-4555-8555-555555555556");
    expect(projection?.conflicts.map((item) => item.reason)).toEqual(
      expect.arrayContaining(["ContainerAlreadyLoaded", "LocationChangeWithoutDeparture"])
    );
  });

  it("flags a processing scan at a new site when no departure was recorded", () => {
    const ledger = new InMemoryEventLedger();
    ledger.submit(
      loadAssigned(undefined, { eventAt: "2026-07-22T12:00:00.000Z" }),
      { tenantId, deviceId },
      new Date("2026-07-22T12:00:01.000Z")
    );
    const emptied = ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777787",
        deviceInstallationId: secondInstallationId,
        deviceSequence: 0,
        containerId,
        locationId: secondLocationId,
        eventType: "emptied",
        eventAt: "2026-07-22T13:00:00.000Z",
        payload: { processedPercentage: 100 }
      },
      { tenantId, deviceId: secondDeviceId },
      new Date("2026-07-22T13:00:01.000Z")
    );

    expect(emptied.status).toBe("accepted_for_review");
    expect(emptied.warnings).toContain("LocationChangeWithoutDeparture");
    expect(ledger.projectionForContainer(tenantId, containerId)?.locationId).toBe(secondLocationId);
  });

  it("flags processing at a new site before a receiving scan closes the departure", () => {
    const ledger = new InMemoryEventLedger();
    ledger.submit(
      loadAssigned(undefined, { eventAt: "2026-07-22T12:00:00.000Z" }),
      { tenantId, deviceId },
      new Date("2026-07-22T12:00:01.000Z")
    );
    ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777790",
        deviceInstallationId: installationId,
        deviceSequence: 1,
        containerId,
        locationId,
        eventType: "batch_out",
        eventAt: "2026-07-22T12:30:00.000Z",
        payload: { sourceLocationId: locationId }
      },
      { tenantId, deviceId },
      new Date("2026-07-22T12:30:01.000Z")
    );

    const processed = ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777791",
        deviceInstallationId: secondInstallationId,
        deviceSequence: 0,
        containerId,
        locationId: secondLocationId,
        eventType: "emptied",
        eventAt: "2026-07-22T13:00:00.000Z",
        payload: { processedPercentage: 100 }
      },
      { tenantId, deviceId: secondDeviceId },
      new Date("2026-07-22T13:00:01.000Z")
    );

    expect(processed.status).toBe("accepted_for_review");
    expect(processed.warnings).toContain("ProcessingWithoutReceipt");
    expect(ledger.projectionForContainer(tenantId, containerId)?.conflicts.map((item) => item.reason)).toContain("ProcessingWithoutReceipt");
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

  it("validates the processed percentage on an empty-container observation", () => {
    const ledger = new InMemoryEventLedger();
    const result = ledger.submit(
      {
        eventId: "77777777-7777-4777-8777-777777777782",
        deviceInstallationId: installationId,
        deviceSequence: 1,
        containerId,
        locationId,
        eventType: "emptied",
        eventAt: "2026-07-22T12:06:00.000Z",
        payload: { processedPercentage: 125 }
      },
      { tenantId, deviceId },
      new Date("2026-07-22T12:06:01.000Z")
    );

    expect(result.accepted).toBe(false);
    expect(result.errorCode).toBe("InvalidPayload");
    expect(result.message).toContain("processedPercentage");
  });
});
