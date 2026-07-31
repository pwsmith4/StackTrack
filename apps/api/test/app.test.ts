import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.js";
import type { DeviceAdministration } from "../src/device-administration.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const containerId = "44444444-4444-4444-8444-444444444444";

const headers = {
  "x-stacktrack-tenant-id": tenantId,
  "x-stacktrack-device-id": deviceId
};

const event = {
  eventId: "77777777-7777-4777-8777-777777777777",
  deviceInstallationId: "33333333-3333-4333-8333-333333333333",
  deviceSequence: 0,
  containerId,
  loadCodeId: "55555555-5555-4555-8555-555555555555",
  locationId: "66666666-6666-4666-8666-666666666666",
  eventType: "load_assigned",
  eventAt: "2026-07-22T12:00:00.000Z"
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("StackTrack API foundation", () => {
  it("accepts an event and returns its projected state", async () => {
    app = createApp({ now: () => new Date("2026-07-22T12:00:01.000Z") });

    const submission = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: event
    });
    const state = await app.inject({
      method: "GET",
      url: `/api/v1/containers/${containerId}/state`,
      headers: { "x-stacktrack-tenant-id": tenantId }
    });
    const states = await app.inject({
      method: "GET",
      url: "/api/v1/containers/states",
      headers: { "x-stacktrack-tenant-id": tenantId }
    });

    expect(submission.statusCode).toBe(201);
    expect(submission.json()).toMatchObject({ accepted: true, status: "accepted" });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({
      containerId,
      loadState: "loaded",
      health: "clean"
    });
    expect(states.statusCode).toBe(200);
    expect(states.json()).toMatchObject({
      count: 1,
      items: [{ containerId, loadState: "loaded" }]
    });
  });

  it("returns a stable response for an idempotent replay", async () => {
    app = createApp({ now: () => new Date("2026-07-22T12:00:01.000Z") });

    await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: event
    });
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: event
    });

    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ accepted: true, status: "duplicate" });
  });

  it("rejects observations from a disabled scanner", async () => {
    const disabledScanner: DeviceAdministration = {
      update: async () => null,
      reportTelemetry: async () => null,
      isScannerEnabled: async () => false
    };
    app = createApp({ deviceAdministration: disabledScanner });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: event
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "ScannerDisabled" });
  });

  it("does not trust unscoped requests", async () => {
    app = createApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/containers/${containerId}/state`
    });

    expect(response.statusCode).toBe(401);
  });

  it("keeps administrator reference data behind an authenticated session", async () => {
    app = createApp({ localMode: true });
    const fixtures = await app.inject({
      method: "GET",
      url: "/api/v1/local/reference-data",
      headers: {
        "x-stacktrack-tenant-id": "10000000-0000-4000-8000-000000000001"
      }
    });

    expect(fixtures.statusCode).toBe(503);

    const mobileReferenceData = await app.inject({
      method: "GET",
      url: "/api/v1/mobile/reference-data",
      headers: {
        "x-stacktrack-tenant-id": "10000000-0000-4000-8000-000000000001",
        "x-stacktrack-device-id": deviceId
      }
    });
    expect(mobileReferenceData.statusCode).toBe(200);
    expect(mobileReferenceData.json().containers).toHaveLength(11);
  });
});
