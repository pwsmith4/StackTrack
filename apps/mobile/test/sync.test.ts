import { describe, expect, it } from "vitest";
import { MemoryQueueStore, OfflineEventQueue } from "@stacktrack/offline-queue";
import { syncPendingEvents } from "../src/index.js";

const installationId = "33333333-3333-4333-8333-333333333333";

async function queueOne(): Promise<OfflineEventQueue> {
  const queue = new OfflineEventQueue(new MemoryQueueStore());
  await queue.initialize(installationId);
  await queue.enqueue({
    eventId: "77777777-7777-4777-8777-777777777777",
    containerId: "44444444-4444-4444-8444-444444444444",
    locationId: "66666666-6666-4666-8666-666666666666",
    eventType: "batch_out",
    eventAt: "2026-07-22T12:00:00.000Z",
    payload: {}
  });
  return queue;
}

describe("syncPendingEvents", () => {
  it("does not resend a server-accepted event", async () => {
    const queue = await queueOne();
    const result = await syncPendingEvents(queue, {
      submit: async () => ({ accepted: true, status: "accepted" })
    });

    expect(result.synced).toBe(1);
    expect(queue.pending()).toHaveLength(0);
  });

  it("keeps a network failure pending with the same event identity", async () => {
    const queue = await queueOne();
    const result = await syncPendingEvents(queue, {
      submit: async () => {
        throw new Error("offline");
      }
    });

    expect(result.pending).toBe(1);
    expect(queue.pending()[0]?.event.eventId).toBe(
      "77777777-7777-4777-8777-777777777777"
    );
    expect(queue.pending()[0]?.attempts).toBe(1);
  });
});

