import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.js";
import type { DeviceAdministration } from "../src/device-administration.js";
import type { AdminPrincipal, PostgresAdminAccess } from "../src/admin-access.js";
import type { CorrectionAdministration } from "../src/correction-administration.js";
import type { LocationAdministration } from "../src/location-administration.js";

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

const supportPrincipal: AdminPrincipal = {
  ...temporaryPasswordPrincipal,
  username: "support",
  role: "support",
  mustChangePassword: false,
  supportExpiresAt: "2026-08-01T00:00:00.000Z"
};

const ownerPrincipal: AdminPrincipal = {
  ...temporaryPasswordPrincipal,
  username: "pilot-owner",
  displayName: "Pilot Owner",
  role: "organization_owner",
  mustChangePassword: false
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("StackTrack API foundation", () => {
  it("returns a safe service response at the container root", async () => {
    app = await createApp();

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "StackTrack API",
      status: "ok",
      health: "/health"
    });
  });

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

  it("scopes a read-only reviewer to explicitly assigned locations", async () => {
    const reviewer: AdminPrincipal = {
      ...ownerPrincipal,
      tenantId: "10000000-0000-4000-8000-000000000001",
      role: "read_only_reviewer",
      locationIds: ["20000000-0000-4000-8000-000000000002"]
    };
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(reviewer) } as unknown as PostgresAdminAccess
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/local/reference-data",
      headers: { authorization: `Bearer ${"r".repeat(32)}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.devices.every((device: { assignedLocationId: string }) => device.assignedLocationId === reviewer.locationIds?.[0])).toBe(true);
    expect(body.locations.some((location: { locationId: string }) => location.locationId === "20000000-0000-4000-8000-000000000003")).toBe(false);
  });

  it("rate limits repeated administrator sign-in attempts", async () => {
    const signIn = vi.fn().mockResolvedValue(null);
    app = await createApp({ localMode: true, adminAccess: { signIn } as unknown as PostgresAdminAccess });
    const responses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(await app.inject({
        method: "POST",
        url: "/api/v1/local/admin/session",
        payload: { username: "root", password: "wrong-password" }
      }));
    }
    expect(responses.slice(0, 5).every((response) => response.statusCode === 401)).toBe(true);
    expect(responses[5]?.statusCode).toBe(429);
    expect(signIn).toHaveBeenCalledTimes(5);
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

  it("rejects malformed telemetry before it reaches the device store", async () => {
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
        "x-stacktrack-device-id": deviceId
      },
      payload: {
        installationId: "not-a-uuid",
        appVersion: "0.3.3",
        pendingOfflineScanCount: 100001
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "InvalidDeviceTelemetry" });
    expect(reportTelemetry).not.toHaveBeenCalled();
  });

  it("does not let a support account control a scanner", async () => {
    const update = vi.fn();
    const administration: DeviceAdministration = {
      update,
      reportTelemetry: async () => null,
      isScannerEnabled: async () => true
    };
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(supportPrincipal) } as unknown as PostgresAdminAccess,
      deviceAdministration: administration
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/local/devices/${deviceId}`,
      headers: { authorization: `Bearer ${"b".repeat(32)}` },
      payload: { isActive: false }
    });

    expect(response.statusCode).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("requires an Organization Owner for a cross-location scanner move", async () => {
    const update = vi.fn();
    const administration: DeviceAdministration = {
      update,
      reportTelemetry: async () => null,
      isScannerEnabled: async () => true
    };
    const operationsPrincipal: AdminPrincipal = {
      ...ownerPrincipal,
      tenantId: "10000000-0000-4000-8000-000000000001",
      role: "operations_administrator"
    };
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(operationsPrincipal) } as unknown as PostgresAdminAccess,
      deviceAdministration: administration
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/local/devices/30000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${"o".repeat(32)}` },
      payload: { assignedLocationId: "20000000-0000-4000-8000-000000000003" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "CorporateApprovalRequired" });
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps correction requests authenticated and delegates the verified actor", async () => {
    const createRequest = vi.fn().mockResolvedValue({
      correctionRequestId: "99999999-9999-4999-8999-999999999999",
      containerId,
      containerLabel: "B1001",
      status: "pending"
    });
    const corrections: CorrectionAdministration = {
      listRequests: vi.fn().mockResolvedValue([]),
      createRequest,
      takeAction: vi.fn(),
      applyApprovedCorrections: vi.fn(async (_tenant, projections) => [...projections])
    };
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(ownerPrincipal) } as unknown as PostgresAdminAccess,
      correctionAdministration: corrections
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/local/correction-requests",
      headers: { authorization: `Bearer ${"c".repeat(32)}` },
      payload: {
        containerId,
        impactLevel: "material",
        reason: "Receiving paperwork confirms the official location.",
        proposedCorrection: { locationId: "66666666-6666-4666-8666-666666666666" }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      item: { correctionRequestId: "99999999-9999-4999-8999-999999999999" }
    });
    expect(createRequest).toHaveBeenCalledWith(
      tenantId,
      ownerPrincipal,
      expect.objectContaining({ impactLevel: "material" })
    );
  });

  it("requires an owner for retirement and delegates location changes with dependency review", async () => {
    const dependencies = {
      location: {
        locationId: "66666666-6666-4666-8666-666666666666",
        name: "Midtown Store",
        type: "store_backroom",
        isActive: true
      },
      devices: [{ deviceId, label: "Scanner 1", isActive: true }],
      currentContainerCount: 2,
      loadCodeCount: 4,
      observationCount: 9
    };
    const locationAdministration: LocationAdministration = {
      dependencies: vi.fn().mockResolvedValue(dependencies),
      create: vi.fn().mockResolvedValue(dependencies.location),
      retire: vi.fn().mockResolvedValue({
        location: { ...dependencies.location, isActive: false },
        movedDeviceCount: 1,
        replacementLocationId: null,
        unknownLocationId: "99999999-9999-4999-8999-999999999999",
        dependencies
      })
    };
    const authenticate = vi.fn().mockResolvedValue(ownerPrincipal);
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate } as unknown as PostgresAdminAccess,
      locationAdministration
    });
    const authorization = { authorization: `Bearer ${"l".repeat(32)}` };
    const preview = await app.inject({
      method: "GET",
      url: "/api/v1/local/locations/66666666-6666-4666-8666-666666666666/dependencies",
      headers: authorization
    });
    const retirement = await app.inject({
      method: "POST",
      url: "/api/v1/local/locations/66666666-6666-4666-8666-666666666666/retire",
      headers: authorization,
      payload: { moveDevicesToUnknown: true, confirmation: "Midtown Store" }
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ currentContainerCount: 2, devices: [{ deviceId }] });
    expect(retirement.statusCode).toBe(200);
    expect(locationAdministration.retire).toHaveBeenCalledWith(
      tenantId,
      { userId: ownerPrincipal.userId },
      "66666666-6666-4666-8666-666666666666",
      { moveDevicesToUnknown: true, confirmation: "Midtown Store" }
    );
  });

  it("does not let a read-only administrator add a location", async () => {
    const create = vi.fn();
    const locationAdministration = { create } as unknown as LocationAdministration;
    const readOnly = { ...ownerPrincipal, role: "read_only_reviewer" as const };
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(readOnly) } as unknown as PostgresAdminAccess,
      locationAdministration
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/local/locations",
      headers: { authorization: `Bearer ${"m".repeat(32)}` },
      payload: { name: "Folsom Store", type: "store_backroom" }
    });
    expect(response.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("requires an owner and delegates administrator password resets", async () => {
    const resetUserPassword = vi.fn().mockResolvedValue({
      ...temporaryPasswordPrincipal,
      mustChangePassword: true
    });
    app = await createApp({
      localMode: true,
      adminAccess: {
        authenticate: vi.fn().mockResolvedValue(ownerPrincipal),
        resetUserPassword
      } as unknown as PostgresAdminAccess
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/local/admin/users/${temporaryPasswordPrincipal.userId}/password-reset`,
      headers: { authorization: `Bearer ${"d".repeat(32)}` },
      payload: { temporaryPassword: "a-new-temporary-password" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { mustChangePassword: true } });
    expect(resetUserPassword).toHaveBeenCalledWith(
      ownerPrincipal,
      temporaryPasswordPrincipal.userId,
      "a-new-temporary-password"
    );
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

  it("delegates governed audit filters and rejects malformed filters", async () => {
    const searchAuditEntries = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(ownerPrincipal), searchAuditEntries } as unknown as PostgresAdminAccess
    });
    const authorization = { authorization: `Bearer ${"e".repeat(32)}` };
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/local/admin/audit-log?locationId=66666666-6666-4666-8666-666666666666&deviceId=22222222-2222-4222-8222-222222222222&actionPrefix=device&targetType=device&from=2026-07-01&to=2026-07-31&limit=20&offset=0",
      headers: authorization
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/local/admin/audit-log?deviceId=not-a-uuid",
      headers: authorization
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 0, limit: 20, offset: 0 });
    expect(searchAuditEntries).toHaveBeenCalledWith(expect.objectContaining({
      locationId: "66666666-6666-4666-8666-666666666666",
      deviceId,
      actionPrefix: "device",
      targetType: "device",
      limit: 20,
      offset: 0
    }));
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: "InvalidAuditFilter" });
  });

  it("accepts exact multi-value audit filters", async () => {
    const searchAuditEntries = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(ownerPrincipal), searchAuditEntries } as unknown as PostgresAdminAccess
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/local/admin/audit-log?actionPrefixes=device,correction&targetTypes=device,correction_request",
      headers: { authorization: `Bearer ${"e".repeat(32)}` }
    });

    expect(response.statusCode).toBe(200);
    expect(searchAuditEntries).toHaveBeenCalledWith(expect.objectContaining({
      actionPrefixes: ["device", "correction"],
      targetTypes: ["device", "correction_request"]
    }));
  });

  it("passes selected locations and scanners through the governed audit search", async () => {
    const searchAuditEntries = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(ownerPrincipal), searchAuditEntries } as unknown as PostgresAdminAccess
    });
    const locationOne = "66666666-6666-4666-8666-666666666666";
    const locationTwo = "77777777-7777-4777-8777-777777777777";
    const scannerOne = "22222222-2222-4222-8222-222222222222";
    const scannerTwo = "33333333-3333-4333-8333-333333333333";
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/local/admin/audit-log?selectedLocationIds=${locationOne},${locationTwo}&selectedDeviceIds=${scannerOne},${scannerTwo}`,
      headers: { authorization: `Bearer ${"e".repeat(32)}` }
    });

    expect(response.statusCode).toBe(200);
    expect(searchAuditEntries).toHaveBeenCalledWith(expect.objectContaining({
      selectedLocationIds: [locationOne, locationTwo],
      selectedDeviceIds: [scannerOne, scannerTwo]
    }));
  });

  it("rejects oversized or malformed selected audit filter lists", async () => {
    const searchAuditEntries = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(ownerPrincipal), searchAuditEntries } as unknown as PostgresAdminAccess
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/local/admin/audit-log?selectedLocationIds=not-a-uuid",
      headers: { authorization: `Bearer ${"e".repeat(32)}` }
    });
    const tooMany = Array.from({ length: 101 }, () => "66666666-6666-4666-8666-666666666666").join(",");
    const oversized = await app.inject({
      method: "GET",
      url: `/api/v1/local/admin/audit-log?selectedDeviceIds=${tooMany}`,
      headers: { authorization: `Bearer ${"e".repeat(32)}` }
    });

    expect(invalid.statusCode).toBe(400);
    expect(oversized.statusCode).toBe(400);
    expect(searchAuditEntries).not.toHaveBeenCalled();
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
