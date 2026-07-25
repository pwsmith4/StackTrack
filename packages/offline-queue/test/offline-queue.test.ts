import { describe, expect, it } from "vitest";
import { MemoryQueueStore, OfflineEventQueue } from "../src/index.js";

describe("OfflineEventQueue", () => {
  it("assigns a durable installation ID and monotonic sequence", async () => {
    const store = new MemoryQueueStore();
    const queue = new OfflineEventQueue(store);
    const installationId = "33333333-3333-4333-8333-333333333333";
    await queue.initialize(installationId);

    const base = {
      containerId: "44444444-4444-4444-8444-444444444444",
      locationId: "66666666-6666-4666-8666-666666666666",
      eventType: "batch_out" as const,
      eventAt: "2026-07-22T12:00:00.000Z",
      payload: {}
    };
    const first = await queue.enqueue({
      ...base,
      eventId: "77777777-7777-4777-8777-777777777777"
    });
    const second = await queue.enqueue({
      ...base,
      eventId: "77777777-7777-4777-8777-777777777778"
    });

    expect(first.deviceInstallationId).toBe(installationId);
    expect(first.deviceSequence).toBe(0);
    expect(second.deviceSequence).toBe(1);
    expect(queue.pending()).toHaveLength(2);
  });
});

