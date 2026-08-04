import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { InMemoryEventLedger } from "@stacktrack/domain";
import { createApp } from "../src/app.js";
import type { DeviceAdministration } from "../src/device-administration.js";
import type { AdminPrincipal, PostgresAdminAccess } from "../src/admin-access.js";
import type { CorrectionAdministration } from "../src/correction-administration.js";
import type { LocationAdministration } from "../src/location-administration.js";
import { localFixtures } from "../src/local-fixtures.js";

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
  eventAt: "2026-07-22T12:00:00.000Z",
  payload: { goodsType: "Soft", secondaryValue: "Raw" }
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

  it("looks up the active load code without writing another observation", async () => {
    app = await createApp({ now: () => new Date("2026-07-22T12:00:01.000Z") });
    await app.inject({ method: "POST", url: "/api/v1/events", headers, payload: event });

    const lookup = await app.inject({
      method: "GET",
      url: `/api/v1/mobile/load-code/${containerId}`,
      headers
    });
    const state = await app.inject({
      method: "GET",
      url: `/api/v1/containers/${containerId}/state`,
      headers: { "x-stacktrack-tenant-id": tenantId }
    });

    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toMatchObject({
      found: true,
      synchronizedAt: "2026-07-22T12:00:01.000Z",
      loadCode: { loadCodeId: event.loadCodeId }
    });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({
      containerId,
      activeLoadCodeId: event.loadCodeId
    });
  });

  it("requires the load-code lookup permission for registered installations", async () => {
    const restrictedScanner: DeviceAdministration = {
      update: async () => null,
      reportTelemetry: async () => null,
      isScannerEnabled: async () => true,
      hasPermission: async (_tenantId, _deviceId, _installationId, permissionKey) => permissionKey !== "load_code.lookup"
    };
    app = await createApp({ deviceAdministration: restrictedScanner });

    const lookup = await app.inject({
      method: "GET",
      url: `/api/v1/mobile/load-code/${containerId}`,
      headers: {
        ...headers,
        "x-stacktrack-device-installation-id": event.deviceInstallationId
      }
    });

    expect(lookup.statusCode).toBe(403);
    expect(lookup.json()).toMatchObject({ error: "DevicePermissionDenied" });
  });

  it("fails closed when production scanner permissions are not configured", async () => {
    const administration: DeviceAdministration = {
      update: async () => null,
      reportTelemetry: async () => null,
      isScannerEnabled: async () => true
    };
    app = await createApp({
      strictDevicePermissions: true,
      deviceAdministration: administration
    });

    const eventResponse = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: event
    });
    const lookupResponse = await app.inject({
      method: "GET",
      url: `/api/v1/mobile/load-code/${containerId}`,
      headers: {
        ...headers,
        "x-stacktrack-device-installation-id": event.deviceInstallationId
      }
    });
    const permissionsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/mobile/permissions",
      headers: {
        ...headers,
        "x-stacktrack-device-installation-id": event.deviceInstallationId
      }
    });
    const telemetryResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/mobile/telemetry`,
      headers,
      payload: {
        installationId: event.deviceInstallationId,
        appVersion: "0.3.3",
        pendingOfflineScanCount: 0
      }
    });

    expect(eventResponse.statusCode).toBe(503);
    expect(eventResponse.json()).toMatchObject({ error: "DevicePermissionConfigurationMissing" });
    expect(lookupResponse.statusCode).toBe(503);
    expect(lookupResponse.json()).toMatchObject({ error: "DevicePermissionConfigurationMissing" });
    expect(permissionsResponse.statusCode).toBe(503);
    expect(permissionsResponse.json()).toMatchObject({ error: "DevicePermissionConfigurationMissing" });
    expect(telemetryResponse.statusCode).toBe(503);
    expect(telemetryResponse.json()).toMatchObject({ error: "DevicePermissionConfigurationMissing" });
  });

  it("accepts valid items in a batch while reporting invalid items individually", async () => {
    app = await createApp({ now: () => new Date("2026-07-22T12:00:01.000Z") });
    const invalidItem = {
      ...event,
      eventId: "99999999-9999-4999-8999-999999999999",
      eventType: "emptied",
      loadCodeId: event.loadCodeId
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events/batch",
      headers,
      payload: { items: [event, invalidItem] }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accepted: true,
      status: "partial",
      acceptedCount: 1,
      rejectedCount: 1,
      results: [
        { index: 0, eventId: event.eventId, accepted: true },
        { index: 1, eventId: invalidItem.eventId, accepted: false, error: "InvalidPayload" }
      ]
    });
  });

  it("keeps a batch alive when one ledger item fails unexpectedly", async () => {
    const ledger = new InMemoryEventLedger();
    const originalSubmit = ledger.submit.bind(ledger);
    vi.spyOn(ledger, "submit")
      .mockImplementationOnce((input, context, receivedAt) => originalSubmit(input, context, receivedAt))
      .mockImplementationOnce(() => {
        throw new Error("stale reference data");
      });
    app = await createApp({ ledger });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events/batch",
      headers,
      payload: {
        items: [
          event,
          { ...event, eventId: "99999999-9999-4999-8999-999999999998", deviceSequence: 1 }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accepted: true,
      status: "partial",
      acceptedCount: 1,
      rejectedCount: 1,
      results: [
        { index: 0, accepted: true },
        { index: 1, accepted: false, error: "ItemProcessingFailed", message: "stale reference data" }
      ]
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

  it("rejects observations when the scanner role does not grant observation permission", async () => {
    const restrictedScanner: DeviceAdministration = {
      update: async () => null,
      reportTelemetry: async () => null,
      isScannerEnabled: async () => true,
      hasPermission: async (_tenantId, _deviceId, _installationId, permissionKey) => permissionKey !== "observation.create"
    };
    app = await createApp({ deviceAdministration: restrictedScanner });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: event
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "DevicePermissionDenied" });
  });

  it("derives a departure origin from the scanner assignment", async () => {
    const assignedLocationId = "66666666-6666-4666-8666-666666666666";
    const administration: DeviceAdministration = {
      update: async () => null,
      reportTelemetry: async () => null,
      isScannerEnabled: async () => true,
      assignedLocationId: async () => assignedLocationId
    };
    app = await createApp({ deviceAdministration: administration });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: {
        ...event,
        eventType: "batch_out",
        loadCodeId: null,
        locationId: "20000000-0000-4000-8000-000000000004",
        payload: {}
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      event: { payload: { sourceLocationId: assignedLocationId } }
    });
  });

  it("rejects a scanner payload that claims another origin or location", async () => {
    const assignedLocationId = "66666666-6666-4666-8666-666666666666";
    const administration: DeviceAdministration = {
      update: async () => null,
      reportTelemetry: async () => null,
      isScannerEnabled: async () => true,
      assignedLocationId: async () => assignedLocationId
    };
    app = await createApp({ deviceAdministration: administration });

    const departure = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: {
        ...event,
        eventType: "batch_out",
        loadCodeId: null,
        locationId: "20000000-0000-4000-8000-000000000004",
        payload: { sourceLocationId: "77777777-7777-4777-8777-777777777777" }
      }
    });
    const wrongSite = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: { ...event, locationId: "77777777-7777-4777-8777-777777777777" }
    });

    expect(departure.statusCode).toBe(403);
    expect(departure.json()).toMatchObject({ error: "ScannerLocationMismatch" });
    expect(wrongSite.statusCode).toBe(403);
    expect(wrongSite.json()).toMatchObject({ error: "ScannerLocationMismatch" });
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

  it("authenticates administrative requests through the replaceable identity provider", async () => {
    const principal: AdminPrincipal = {
      ...ownerPrincipal,
      tenantId: "10000000-0000-4000-8000-000000000001"
    };
    const authenticateAccessToken = vi.fn().mockResolvedValue(principal);
    app = await createApp({
      localMode: true,
      identityProvider: { authenticateAccessToken }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/local/reference-data",
      headers: { authorization: `Bearer ${"e".repeat(32)}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().tenant.tenantId).toBe(principal.tenantId);
    expect(authenticateAccessToken).toHaveBeenCalledWith("e".repeat(32));
  });

  it("exposes governed admin reads in cloud mode without exposing the pilot password bridge", async () => {
    const principal: AdminPrincipal = {
      ...ownerPrincipal,
      tenantId: "10000000-0000-4000-8000-000000000001"
    };
    const authenticateAccessToken = vi.fn().mockResolvedValue(principal);
    app = await createApp({
      identityProvider: { authenticateAccessToken },
      referenceData: async () => localFixtures
    });

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/local/reference-data"
    });
    const authenticated = await app.inject({
      method: "GET",
      url: "/api/v1/local/reference-data",
      headers: { authorization: `Bearer ${"c".repeat(32)}` }
    });
    const passwordBridge = await app.inject({
      method: "POST",
      url: "/api/v1/local/admin/session",
      payload: { username: "root", password: "password" }
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json().tenant.tenantId).toBe(principal.tenantId);
    expect(passwordBridge.statusCode).toBe(404);
    expect(authenticateAccessToken).toHaveBeenCalledWith("c".repeat(32));
  });

  it("keeps the mobile control plane available when the API is not in local-admin mode", async () => {
    const administration: DeviceAdministration = {
      update: async () => null,
      reportTelemetry: async () => null,
      isScannerEnabled: async () => true,
      hasPermission: async () => true,
      permissionKeys: async () => ["reference_data.read", "load_code.lookup"]
    };
    app = await createApp({
      referenceData: async () => localFixtures,
      deviceAdministration: administration,
      strictDevicePermissions: true
    });

    const referenceData = await app.inject({
      method: "GET",
      url: "/api/v1/mobile/reference-data",
      headers: {
        ...headers,
        "x-stacktrack-device-installation-id": event.deviceInstallationId
      }
    });
    const permissions = await app.inject({
      method: "GET",
      url: "/api/v1/mobile/permissions",
      headers: {
        ...headers,
        "x-stacktrack-device-installation-id": event.deviceInstallationId
      }
    });

    expect(referenceData.statusCode).toBe(200);
    expect(referenceData.json().containers).toHaveLength(11);
    expect(permissions.statusCode).toBe(200);
    expect(permissions.json()).toMatchObject({
      permissionKeys: ["reference_data.read", "load_code.lookup"],
      enforced: true
    });
  });

  it("turns a missing device-role migration into a safe configuration response", async () => {
    const missingSchema = Object.assign(new Error("relation device_roles does not exist"), { code: "42P01" });
    const administration: DeviceAdministration = {
      update: async () => null,
      reportTelemetry: async () => null,
      isScannerEnabled: async () => true,
      hasPermission: async () => { throw missingSchema; },
      permissionKeys: async () => { throw missingSchema; }
    };
    app = await createApp({
      referenceData: async () => localFixtures,
      deviceAdministration: administration,
      strictDevicePermissions: true
    });

    const headersWithInstallation = {
      ...headers,
      "x-stacktrack-device-installation-id": event.deviceInstallationId
    };
    const permissions = await app.inject({
      method: "GET",
      url: "/api/v1/mobile/permissions",
      headers: headersWithInstallation
    });
    const referenceData = await app.inject({
      method: "GET",
      url: "/api/v1/mobile/reference-data",
      headers: headersWithInstallation
    });

    expect(permissions.statusCode).toBe(503);
    expect(permissions.json()).toMatchObject({ error: "DevicePermissionConfigurationMissing" });
    expect(referenceData.statusCode).toBe(503);
    expect(referenceData.json()).toMatchObject({ error: "DevicePermissionConfigurationMissing" });
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

  it("records a non-enumerating sign-in help request for administrators", async () => {
    const requestAccessHelp = vi.fn().mockResolvedValue({
      requestId: "99999999-9999-4999-8999-999999999999",
      occurredAt: "2026-07-31T12:00:00.000Z"
    });
    app = await createApp({ localMode: true, adminAccess: { requestAccessHelp } as unknown as PostgresAdminAccess });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/local/admin/access-issues",
      payload: { username: "new-admin", message: "My scanner console password is not working." }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ accepted: true, requestId: "99999999-9999-4999-8999-999999999999" });
    expect(requestAccessHelp).toHaveBeenCalledWith("new-admin", "My scanner console password is not working.");
  });

  it("validates sign-in help messages without accepting account probing fields", async () => {
    const requestAccessHelp = vi.fn();
    app = await createApp({ localMode: true, adminAccess: { requestAccessHelp } as unknown as PostgresAdminAccess });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/local/admin/access-issues",
      payload: { username: 17, message: "short" }
    });

    expect(response.statusCode).toBe(400);
    expect(requestAccessHelp).not.toHaveBeenCalled();
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

  it("requires an owner and exact confirmation for permanent administrator removal", async () => {
    const removeUser = vi.fn().mockResolvedValue({
      userId: temporaryPasswordPrincipal.userId,
      username: temporaryPasswordPrincipal.username,
      displayName: temporaryPasswordPrincipal.displayName,
      role: temporaryPasswordPrincipal.role
    });
    app = await createApp({
      localMode: true,
      adminAccess: {
        authenticate: vi.fn().mockResolvedValue(ownerPrincipal),
        removeUser
      } as unknown as PostgresAdminAccess
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/local/admin/users/${temporaryPasswordPrincipal.userId}`,
      headers: { authorization: `Bearer ${"r".repeat(32)}` },
      payload: { confirmation: temporaryPasswordPrincipal.username }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ removed: { username: "new-admin" } });
    expect(removeUser).toHaveBeenCalledWith(ownerPrincipal, temporaryPasswordPrincipal.userId, "new-admin");
  });

  it("starts a lower-role preview without changing the real administrator session", async () => {
    const sessionToken = "p".repeat(32);
    const previewLocationId = "66666666-6666-4666-8666-666666666666";
    const preview = {
      previewToken: "preview-token-which-is-long-enough-for-the-client",
      expiresAt: "2026-08-03T20:30:00.000Z",
      preview: {
        sourceRole: "organization_owner" as const,
        previewRole: "location_manager" as const,
        locationIds: [previewLocationId],
        expiresAt: "2026-08-03T20:30:00.000Z"
      },
      principal: {
        ...ownerPrincipal,
        role: "location_manager" as const,
        locationIds: [previewLocationId],
        rolePreview: {
          sourceRole: "organization_owner" as const,
          previewRole: "location_manager" as const,
          locationIds: [previewLocationId],
          expiresAt: "2026-08-03T20:30:00.000Z"
        }
      }
    };
    const startRolePreview = vi.fn().mockResolvedValue(preview);
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(ownerPrincipal), startRolePreview } as unknown as PostgresAdminAccess
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/local/admin/role-preview",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { role: "location_manager", locationIds: [previewLocationId] }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ preview: { previewRole: "location_manager", locationIds: [previewLocationId] } });
    expect(startRolePreview).toHaveBeenCalledWith(ownerPrincipal, sessionToken, "location_manager", [previewLocationId]);
  });

  it("blocks all write routes while a lower-role preview is active", async () => {
    const previewLocationId = "66666666-6666-4666-8666-666666666666";
    const previewPrincipal: AdminPrincipal = {
      ...ownerPrincipal,
      role: "location_manager",
      locationIds: [previewLocationId],
      rolePreview: {
        sourceRole: "organization_owner",
        previewRole: "location_manager",
        locationIds: [previewLocationId],
        expiresAt: "2026-08-03T20:30:00.000Z"
      }
    };
    const resolveRolePreview = vi.fn().mockResolvedValue(previewPrincipal);
    app = await createApp({
      localMode: true,
      adminAccess: {
        authenticate: vi.fn().mockResolvedValue(ownerPrincipal),
        resolveRolePreview
      } as unknown as PostgresAdminAccess
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/local/admin/users",
      headers: {
        authorization: `Bearer ${"q".repeat(32)}`,
        "x-stacktrack-role-preview": "preview-capability-token-that-is-long-enough"
      },
      payload: { username: "new-user", displayName: "New User", role: "read_only_reviewer", temporaryPassword: "a-long-temporary-password" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "RolePreviewReadOnly" });
    expect(resolveRolePreview).toHaveBeenCalled();
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
