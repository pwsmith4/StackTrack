import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.js";
import type { AdminPrincipal, PostgresAdminAccess } from "../src/admin-access.js";
import type { LocationAdministration } from "../src/location-administration.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const owner: AdminPrincipal = {
  tenantId,
  userId: "22222222-2222-4222-8222-222222222222",
  username: "owner",
  displayName: "Owner",
  role: "organization_owner",
  supportExpiresAt: null,
  isActive: true,
  mustChangePassword: false
};
const locationId = "33333333-3333-4333-8333-333333333333";
const authorization = { authorization: `Bearer ${"l".repeat(32)}` };

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("location administration routes", () => {
  it("delegates location name/type edits and location-type catalog changes", async () => {
    const update = vi.fn().mockResolvedValue({ locationId, name: "Folsom Store", type: "store_backroom", isActive: true });
    const createType = vi.fn().mockResolvedValue({ typeKey: "outlet", name: "Outlet", category: "store_backroom", iconKey: "store", isSystem: false, isActive: true });
    const updateType = vi.fn().mockResolvedValue({ typeKey: "outlet", name: "Outlet", category: "store_backroom", iconKey: "warehouse", isSystem: false, isActive: true });
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(owner) } as unknown as PostgresAdminAccess,
      locationAdministration: { update, createType, updateType } as unknown as LocationAdministration
    });

    const locationResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/local/locations/${locationId}`,
      headers: authorization,
      payload: { name: "Folsom Store", type: "store_backroom" }
    });
    const createTypeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/local/location-types",
      headers: authorization,
      payload: { name: "Outlet", category: "store_backroom", iconKey: "store" }
    });
    const updateTypeResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/local/location-types/outlet",
      headers: authorization,
      payload: { name: "Outlet", iconKey: "warehouse" }
    });

    expect(locationResponse.statusCode).toBe(200);
    expect(createTypeResponse.statusCode).toBe(201);
    expect(updateTypeResponse.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(tenantId, { userId: owner.userId }, locationId, { name: "Folsom Store", type: "store_backroom" });
    expect(createType).toHaveBeenCalledWith(tenantId, { userId: owner.userId }, { name: "Outlet", category: "store_backroom", iconKey: "store" });
    expect(updateType).toHaveBeenCalledWith(tenantId, { userId: owner.userId }, "outlet", { name: "Outlet", iconKey: "warehouse" });
  });

  it("does not let a read-only reviewer change names or location types", async () => {
    const update = vi.fn();
    const createType = vi.fn();
    const readOnly = { ...owner, role: "read_only_reviewer" as const };
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(readOnly) } as unknown as PostgresAdminAccess,
      locationAdministration: { update, createType } as unknown as LocationAdministration
    });

    const locationResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/local/locations/${locationId}`,
      headers: authorization,
      payload: { name: "Folsom Store", type: "store_backroom" }
    });
    const typeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/local/location-types",
      headers: authorization,
      payload: { name: "Outlet", category: "other", iconKey: "map-pin" }
    });

    expect(locationResponse.statusCode).toBe(403);
    expect(typeResponse.statusCode).toBe(403);
    expect(update).not.toHaveBeenCalled();
    expect(createType).not.toHaveBeenCalled();
  });
});
