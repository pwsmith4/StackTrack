import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import { PostgresReviewAdministration } from "../src/review-administration.js";

const tenantId = "11111111-1111-4111-8111-111111111111";

describe("PostgresReviewAdministration", () => {
  it("lists review cases without grouping non-aggregate review columns", async () => {
    let selectSql = "";
    const client = {
      query: vi.fn(async (text: string) => {
        if (text.includes("FROM review_cases rc")) {
          selectSql = text;
          return {
            rows: [
              {
                review_case_id: "22222222-2222-4222-8222-222222222222",
                container_id: "33333333-3333-4333-8333-333333333333",
                container_label: "B1001",
                reason_code: "conflicting_observation",
                evidence_event_ids: ["44444444-4444-4444-8444-444444444444"],
                opened_at: "2026-07-30T12:00:00.000Z",
                latest_action: "assigned",
                latest_action_at: "2026-07-30T12:05:00.000Z",
                latest_action_reason: "Assigned to the pilot manager.",
                action_count: 1
              }
            ]
          } as QueryResult;
        }
        return { rows: [] } as unknown as QueryResult;
      }),
      release: vi.fn()
    } as unknown as PoolClient;
    const pool = {
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool;

    const cases = await new PostgresReviewAdministration(pool).listCases(tenantId);

    expect(cases).toEqual([
      expect.objectContaining({
        containerLabel: "B1001",
        status: "assigned",
        actionCount: 1
      })
    ]);
    expect(selectSql).toContain("action_summary.action_count");
    expect(selectSql).not.toContain("GROUP BY");
  });
});
