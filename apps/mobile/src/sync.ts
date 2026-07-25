import type { EventSubmission } from "@stacktrack/domain";
import type { OfflineEventQueue } from "@stacktrack/offline-queue";

export interface SyncResponse {
  readonly accepted: boolean;
  readonly status:
    | "accepted"
    | "accepted_with_warning"
    | "accepted_for_review"
    | "duplicate"
    | "rejected";
  readonly message?: string;
}

export interface SyncTransport {
  submit(event: EventSubmission): Promise<SyncResponse>;
}

export interface SyncSummary {
  readonly synced: number;
  readonly needsReview: number;
  readonly pending: number;
}

export async function syncPendingEvents(
  queue: OfflineEventQueue,
  transport: SyncTransport
): Promise<SyncSummary> {
  let synced = 0;
  let needsReview = 0;
  let pending = 0;

  for (const queued of queue.pending()) {
    try {
      const response = await transport.submit(queued.event);
      if (response.accepted && response.status === "accepted_for_review") {
        await queue.markNeedsReview(
          queued.event.eventId,
          response.message ?? "Server accepted this observation for administrative review."
        );
        needsReview += 1;
      } else if (response.accepted) {
        await queue.markSynced(queued.event.eventId);
        synced += 1;
      } else {
        await queue.markNeedsReview(
          queued.event.eventId,
          response.message ?? "Server rejected this observation."
        );
        needsReview += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network sync failed.";
      await queue.markRetry(queued.event.eventId, message);
      pending += 1;
    }
  }

  return { synced, needsReview, pending };
}

