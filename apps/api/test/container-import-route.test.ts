import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.js";
import type { AdminPrincipal, PostgresAdminAccess } from "../src/admin-access.js";
import type { ContainerAdministration } from "../src/container-administration.js";

const owner: AdminPrincipal = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  username: "owner",
  displayName: "Owner",
  role: "organization_owner",
  supportExpiresAt: null,
  isActive: true,
  mustChangePassword: false
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("container import administration route", () => {
  it("delegates a validated admin import and returns the atomic result", async () => {
    const administration: ContainerAdministration = {
      import: vi.fn().mockResolvedValue({
        importedCount: 1,
        containers: [{ containerId: "33333333-3333-4333-8333-333333333333", label: "B4001", type: "bin" }]
      })
    };
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue(owner) } as unknown as PostgresAdminAccess,
      containerAdministration: administration
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/local/containers/import",
      headers: { authorization: `Bearer ${"i".repeat(32)}` },
      payload: { rows: [{ label: "B4001", type: "bin" }] }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ importedCount: 1, containers: [{ label: "B4001" }] });
    expect(administration.import).toHaveBeenCalledWith(owner.tenantId, { userId: owner.userId }, [{ label: "B4001", type: "bin" }]);
  });

  it("does not let a read-only reviewer invoke the import adapter", async () => {
    const administration: ContainerAdministration = { import: vi.fn() };
    app = await createApp({
      localMode: true,
      adminAccess: { authenticate: vi.fn().mockResolvedValue({ ...owner, role: "read_only_reviewer" }) } as unknown as PostgresAdminAccess,
      containerAdministration: administration
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/local/containers/import",
      headers: { authorization: `Bearer ${"i".repeat(32)}` },
      payload: { rows: [{ label: "B4001", type: "bin" }] }
    });
    expect(response.statusCode).toBe(403);
    expect(administration.import).not.toHaveBeenCalled();
  });
});
