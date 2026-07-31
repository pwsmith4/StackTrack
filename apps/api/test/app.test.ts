import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.js";
import type { DeviceAdministration } from "../src/device-administration.js";
import type { AdminPrincipal, PostgresAdminAccess } from "../src/admin-access.js";

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

const temporaryPasswordPrincipal: AdminPrincipal = {
  tenantId,
  userId: "88888888-8888-4888-8888-888888888888",
  username: "new-admin",
  displayName: "New Administrator",
  role: "operations_administrator",
  supportExpiresAt: null,
  isActive: true,
  mustChangePassword: true
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("StackTrack API foundation", () => {
  it("accepts an event and returns its projected state", async () => {
    app = await createApp({ now: () => new Date("2026-07-22T12:00:01.000Z") });

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
    app = await createApp({ now: () => new Date("2026-07-22T12:00:01.000Z") });

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
    app = await createApp({ deviceAdministration: disabledScanner });

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
    app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/containers/${containerId}/state`
    });

    expect(response.statusCode).toBe(401);
  });

  it("keeps administrator reference data behind an authenticated session", async () => {
    app = await createApp({ localMode: true });
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

  it("requires a temporary administrator password to be changed before operational data is returned", async () => {
    const changePassword = vi.fn().mockResolvedValue(undefined);
    const access = {
      authenticate: vi.fn().mockResolvedValue(temporaryPasswordPrincipal),
      changePassword
    } as unknown as PostgresAdminAccess;
    app = await createApp({ localMode: true, adminAccess: access });
    const authorization = { authorization: `Bearer ${"a".repeat(32)}` };

    const protectedData = await app.inject({
      method: "GET",
      url: "/api/v1/local/reference-data",
      headers: authorization
    });
    const passwordChange = await app.inject({
      method: "PATCH",
      url: "/api/v1/local/admin/me/password",
      headers: authorization,
      payload: { currentPassword: "temporary-password", newPassword: "a-private-password" }
    });

    expect(protectedData.statusCode).toBe(409);
    expect(protectedData.json()).toMatchObject({ error: "PasswordChangeRequired" });
    expect(passwordChange.statusCode).toBe(204);
    expect(changePassword).toHaveBeenCalledOnce();
  });

  it("rejects telemetry that claims a different scanner identity", async () => {
    const reportTelemetry = vi.fn();
    const administration: DeviceAdministration = {
      update: async () => null,
      reportTelemetry,
      isScannerEnabled: async () => true
    };
    app = await createApp({ localMode: true, deviceAdministration: administration });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/local/devices/${deviceId}/telemetry`,
      headers: {
        "x-stacktrack-tenant-id": tenantId,
        "x-stacktrack-device-id": "33333333-3333-4333-8333-333333333333"
      },
      payload: { installationId: "33333333-3333-4333-8333-333333333333", appVersion: "0.3.2", pendingOfflineScanCount: 0 }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "DeviceIdentityMismatch" });
    expect(reportTelemetry).not.toHaveBeenCalled();
  });

  it("rate limits repeated administrator sign-in attempts", async () => {
    const signIn = vi.fn().mockResolvedValue(null);
    app = await createApp({ localMode: true, adminAccess: { signIn } as unknown as PostgresAdminAccess });
    const responses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(await app.inject({
        method: "POST",
        url: "/api/v1/local/admin/session",
        payload: { username: "root", password: "incorrect-password" }
      }));
    }

    expect(responses.slice(0, 5).every((response) => response.statusCode === 401)).toBe(true);
    expect(responses[5]?.statusCode).toBe(429);
    expect(signIn).toHaveBeenCalledTimes(5);
  });

  it("only emits CORS access headers for approved StackTrack browser origins", async () => {
    app = await createApp({ localMode: true });
    const request = {
      method: "GET" as const,
      url: "/api/v1/mobile/reference-data",
      headers: {
        "x-stacktrack-tenant-id": "10000000-0000-4000-8000-000000000001",
        "x-stacktrack-device-id": deviceId
      }
    };
    const allowed = await app.inject({ ...request, headers: { ...request.headers, origin: "https://pwsmith4.github.io" } });
    const rejected = await app.inject({ ...request, headers: { ...request.headers, origin: "https://untrusted.example" } });

    expect(allowed.headers["access-control-allow-origin"]).toBe("https://pwsmith4.github.io");
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
