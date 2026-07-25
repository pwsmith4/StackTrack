import type { EventSubmission } from "@stacktrack/domain";

export type QueueStatus = "pending" | "syncing" | "synced" | "needs_review";

export interface QueuedEvent {
  readonly event: EventSubmission;
  readonly queuedAt: string;
  readonly status: QueueStatus;
  readonly attempts: number;
  readonly lastError?: string;
}

export interface QueueSnapshot {
  readonly deviceInstallationId: string;
  readonly nextSequence: number;
  readonly events: readonly QueuedEvent[];
}

export interface QueueStore {
  load(): Promise<QueueSnapshot | null>;
  save(snapshot: QueueSnapshot): Promise<void>;
}

export class OfflineEventQueue {
  readonly #store: QueueStore;
  #snapshot: QueueSnapshot | null = null;

  public constructor(store: QueueStore) {
    this.#store = store;
  }

  public async initialize(deviceInstallationId: string): Promise<void> {
    const existing = await this.#store.load();
    this.#snapshot = existing ?? {
      deviceInstallationId,
      nextSequence: 0,
      events: []
    };
    await this.#store.save(this.#snapshot);
  }

  public async enqueue(
    event: Omit<EventSubmission, "deviceInstallationId" | "deviceSequence">
  ): Promise<EventSubmission> {
    const snapshot = this.#requireSnapshot();
    const sequenced: EventSubmission = {
      ...event,
      deviceInstallationId: snapshot.deviceInstallationId,
      deviceSequence: snapshot.nextSequence
    };
    this.#snapshot = {
      ...snapshot,
      nextSequence: snapshot.nextSequence + 1,
      events: [
        ...snapshot.events,
        {
          event: sequenced,
          queuedAt: new Date().toISOString(),
          status: "pending",
          attempts: 0
        }
      ]
    };
    await this.#store.save(this.#snapshot);
    return sequenced;
  }

  public pending(): readonly QueuedEvent[] {
    return this.#requireSnapshot().events.filter(
      (queued) => queued.status === "pending"
    );
  }

  public async markSynced(eventId: string): Promise<void> {
    await this.#update(eventId, (queued) => ({ ...queued, status: "synced" }));
  }

  public async markNeedsReview(eventId: string, reason: string): Promise<void> {
    await this.#update(eventId, (queued) => ({
      ...queued,
      status: "needs_review",
      attempts: queued.attempts + 1,
      lastError: reason
    }));
  }

  public async markRetry(eventId: string, reason: string): Promise<void> {
    await this.#update(eventId, (queued) => ({
      ...queued,
      status: "pending",
      attempts: queued.attempts + 1,
      lastError: reason
    }));
  }

  async #update(
    eventId: string,
    update: (queued: QueuedEvent) => QueuedEvent
  ): Promise<void> {
    const snapshot = this.#requireSnapshot();
    this.#snapshot = {
      ...snapshot,
      events: snapshot.events.map((queued) =>
        queued.event.eventId === eventId ? update(queued) : queued
      )
    };
    await this.#store.save(this.#snapshot);
  }

  #requireSnapshot(): QueueSnapshot {
    if (!this.#snapshot) {
      throw new Error("OfflineEventQueue must be initialized before use.");
    }
    return this.#snapshot;
  }
}

export class MemoryQueueStore implements QueueStore {
  #snapshot: QueueSnapshot | null = null;

  public async load(): Promise<QueueSnapshot | null> {
    return this.#snapshot;
  }

  public async save(snapshot: QueueSnapshot): Promise<void> {
    this.#snapshot = snapshot;
  }
}
