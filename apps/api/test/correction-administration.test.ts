import { describe, expect, it, vi } from "vitest";
import type { ContainerProjection } from "@stacktrack/domain";
import type { Pool, PoolClient, QueryResult } from "pg";
import type { AdminPrincipal } from "../src/admin-access.js";
import { PostgresCorrectionAdministration } from "../src/correction-administration.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const containerId = "33333333-3333-4333-8333-333333333333";
const correctedLocationId = "55555555-5555-4555-8555-555555555555";

function projection(lastReceivedAt: string): ContainerProjection {
  return {
    tenantId,
    containerId,
    loadState: "loaded",
    activeLoadCodeId: "66666666-6666-4666-8666-666666666666",
    locationId: "44444444-4444-4444-8444-444444444444",
    health: "clean",
    warnings: [],
    appliedEventIds: [],
    conflicts: [],
    lastObservedAt: lastReceivedAt,
    lastEffectiveAt: lastReceivedAt,
    lastReceivedAt
  };
}

describe("PostgresCorrectionAdministration", () => {
  it("maps the append-only decision history without grouping request columns", async () => {
    let selectSql = "";
    const client = {
      query: vi.fn(async (text: string) => {
        if (text.includes("FROM correction_requests cr") && text.includes("action_summary")) {
          selectSql = text;
          return {
            rows: [{
              correction_request_id: "22222222-2222-4222-8222-222222222222",
              container_id: containerId,
              container_label: "B1001",
              requested_by_user_id: "77777777-7777-4777-8777-777777777777",
              requested_by_display_name: "Pilot Owner",
              impact_level: "material",
              reason: "The receiving paperwork confirms a different location.",
              proposed_correction: { locationId: correctedLocationId },
              requested_at: "2026-07-30T12:00:00.000Z",
              latest_action: "approved",
              latest_action_at: "2026-07-30T12:05:00.000Z",
              latest_action_reason: "Verified against receiving evidence.",
              latest_actor_display_name: "Corporate Owner",
              action_count: 1
            }]
          } as unknown as QueryResult;
        }
        return { rows: [] } as unknown as QueryResult;
      }),
      release: vi.fn()
    } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    const requests = await new PostgresCorrectionAdministration(pool).listRequests(tenantId);

    expect(requests).toEqual([
      expect.objectContaining({
        containerLabel: "B1001",
        status: "approved",
        actionCount: 1
      })
    ]);
    expect(selectSql).toContain("action_summary.action_count");
    expect(selectSql).not.toContain("GROUP BY");
  });

  it("applies an approved correction only until a newer physical scan arrives", async () => {
    const client = {
      query: vi.fn(async (text: string) => {
        if (text.includes("DISTINCT ON (cr.container_id)")) {
          return {
            rows: [{
              correction_request_id: "22222222-2222-4222-8222-222222222222",
              container_id: containerId,
              proposed_correction: { locationId: correctedLocationId, loadState: "empty" },
              approved_at: "2026-07-30T12:05:00.000Z",
              approved_reason: "Verified against receiving evidence.",
              approved_by_display_name: "Corporate Owner"
            }]
          } as unknown as QueryResult;
        }
        return { rows: [] } as unknown as QueryResult;
      }),
      release: vi.fn()
    } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const administration = new PostgresCorrectionAdministration(pool);

    const [corrected, superseded] = await administration.applyApprovedCorrections(tenantId, [
      projection("2026-07-30T12:00:00.000Z"),
      { ...projection("2026-07-30T12:10:00.000Z"), containerId }
    ]);

    expect(corrected).toMatchObject({
      locationId: correctedLocationId,
      loadState: "empty",
      activeLoadCodeId: null,
      administrativeCorrection: {
        correctionRequestId: "22222222-2222-4222-8222-222222222222",
        approvedByDisplayName: "Corporate Owner"
      }
    });
    expect(superseded).toEqual(projection("2026-07-30T12:10:00.000Z"));
  });

  it("serializes decisions without UPDATE permission on append-only requests", async () => {
    const sql: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        sql.push(text);
        if (text.includes("SELECT requested_by_user_id")) {
          return {
            rows: [{
              requested_by_user_id: "77777777-7777-4777-8777-777777777777",
              impact_level: "routine"
            }]
          } as unknown as QueryResult;
        }
        if (text.includes("FROM correction_actions") && text.includes("LIMIT 1") && !text.includes("latest_action")) {
          return { rows: [] } as unknown as QueryResult;
        }
        if (text.includes("FROM correction_requests cr") && text.includes("action_summary")) {
          return {
            rows: [{
              correction_request_id: "22222222-2222-4222-8222-222222222222",
              container_id: containerId,
              container_label: "B1001",
              requested_by_user_id: "77777777-7777-4777-8777-777777777777",
              requested_by_display_name: "Pilot Owner",
              impact_level: "routine",
              reason: "The paperwork confirms a different location.",
              proposed_correction: { locationId: correctedLocationId },
              requested_at: "2026-07-30T12:00:00.000Z",
              latest_action: "approved",
              latest_action_at: "2026-07-30T12:05:00.000Z",
              latest_action_reason: "Verified against receiving evidence.",
              latest_actor_display_name: "Pilot Owner",
              action_count: 1
            }]
          } as unknown as QueryResult;
        }
        return { rows: [] } as unknown as QueryResult;
      }),
      release: vi.fn()
    } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const actor: AdminPrincipal = {
      tenantId,
      userId: "88888888-8888-4888-8888-888888888888",
      username: "owner",
      displayName: "Pilot Owner",
      role: "organization_owner",
      supportExpiresAt: null,
      isActive: true,
      mustChangePassword: false
    };

    const decided = await new PostgresCorrectionAdministration(pool).takeAction(
      tenantId,
      actor,
      "22222222-2222-4222-8222-222222222222",
      "approved",
      "Verified against receiving evidence."
    );

    expect(decided.status).toBe("approved");
    expect(sql.some((text) => text.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(sql.some((text) => text.includes("FOR UPDATE"))).toBe(false);
  });
});
