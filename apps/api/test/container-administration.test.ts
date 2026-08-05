import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { ContainerImportRejected, PostgresContainerAdministration } from "../src/container-administration.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const actor = { userId: "22222222-2222-4222-8222-222222222222" };

function fakePool(query: PoolClient["query"]): Pool {
  const client = {
    query,
    release: vi.fn()
  } as unknown as PoolClient;
  return { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
}

describe("Postgres container administration", () => {
  it("rejects labels that already exist even when the old container is inactive", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.includes("set_config")) return { rows: [] };
      if (sql.includes("FROM container_types")) return { rows: [{ container_type_id: "type-1", type_name: "bin" }] };
      if (sql.includes("FROM containers")) return { rows: [{ label: "B4001" }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const administration = new PostgresContainerAdministration(fakePool(query as unknown as PoolClient["query"]));

    await expect(administration.import(tenantId, actor, [{ label: "b4001", type: "bin" }])).rejects.toMatchObject({
      name: "ContainerImportRejected",
      rowErrors: [{ row: 2, message: expect.stringContaining("already exists") }]
    } satisfies Partial<ContainerImportRejected>);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO containers"))).toBe(false);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });
});
