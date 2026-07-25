import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import {
  InMemoryEventLedger,
  storedEventSchema,
  type ContainerProjection,
  type EventLedger,
  type RequestContext,
  type StoredEvent,
  type SubmissionResult
} from "@stacktrack/domain";
import { z } from "zod";

const snapshotSchema = z.object({
  version: z.literal(1),
  events: z.array(storedEventSchema)
});

interface LocalSnapshot {
  readonly version: 1;
  readonly events: readonly StoredEvent[];
}

export class LocalFileEventLedger implements EventLedger {
  readonly #path: string;
  #events: StoredEvent[];
  #ledger: InMemoryEventLedger;

  public constructor(path: string) {
    this.#path = path;
    this.#events = this.#read();
    this.#ledger = new InMemoryEventLedger({}, this.#events);
  }

  public submit(
    input: unknown,
    context: RequestContext,
    receivedAt?: Date
  ): SubmissionResult {
    const result = this.#ledger.submit(input, context, receivedAt);
    if (result.accepted && result.status !== "duplicate" && result.event) {
      this.#events.push(result.event);
      this.#persist();
    }
    return result;
  }

  public eventsForContainer(
    tenantId: string,
    containerId: string
  ): readonly StoredEvent[] {
    return this.#ledger.eventsForContainer(tenantId, containerId);
  }

  public eventsForTenant(tenantId: string): readonly StoredEvent[] {
    return this.#ledger.eventsForTenant(tenantId);
  }

  public projectionForContainer(
    tenantId: string,
    containerId: string
  ): ContainerProjection | null {
    return this.#ledger.projectionForContainer(tenantId, containerId);
  }

  public reviewQueue(tenantId: string): readonly ContainerProjection[] {
    return this.#ledger.reviewQueue(tenantId);
  }

  public reset(): void {
    this.#events = [];
    this.#ledger = new InMemoryEventLedger();
    this.#persist();
  }

  #read(): StoredEvent[] {
    if (!existsSync(this.#path)) {
      return [];
    }

    const parsedJson: unknown = JSON.parse(readFileSync(this.#path, "utf8"));
    const parsed = snapshotSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(
        `Local StackTrack data is invalid at ${this.#path}: ${parsed.error.message}`
      );
    }
    return parsed.data.events;
  }

  #persist(): void {
    const snapshot: LocalSnapshot = { version: 1, events: this.#events };
    const directory = dirname(this.#path);
    const temporaryPath = `${this.#path}.writing`;
    mkdirSync(directory, { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, this.#path);
  }
}

