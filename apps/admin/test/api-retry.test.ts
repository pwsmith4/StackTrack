import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOperationsData, type AdminSession } from "../src/api.js";

const session: AdminSession = {
  token: "a".repeat(32),
  expiresAt: "2026-08-01T00:00:00.000Z",
  principal: {
    tenantId: "10000000-0000-4000-8000-000000000001",
    userId: "20000000-0000-4000-8000-000000000001",
    username: "root",
    displayName: "Parker Smith",
    role: "organization_owner",
    supportExpiresAt: null,
    isActive: true,
    mustChangePassword: false
  }
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("admin API reads", () => {
  it("retries a transient network failure before reporting the API as unavailable", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({
        tenant: { tenantId: session.principal.tenantId, name: "Goodwill Local" },
        locations: [],
        devices: [],
        deviceAssignments: [],
        containers: [],
        goodsTypes: []
      }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const request = loadOperationsData(session);
    await vi.advanceTimersByTimeAsync(750);

    await expect(request).resolves.toMatchObject({
      fixtures: { tenant: { name: "Goodwill Local" } },
      events: [],
      reviewCases: [],
      auditEntries: [],
      projections: {}
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
