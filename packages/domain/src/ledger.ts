import {
  assessClock,
  assessReferenceData,
  assessSequence,
  defaultAccuracyThresholds,
  effectiveEventAt,
  isReviewFlag,
  type AccuracyThresholds
} from "./accuracy.js";
import { canonicalJson } from "./canonical-json.js";
import {
  eventSubmissionSchema,
  type EventSubmission,
  type RequestContext,
  type StoredEvent,
  type SubmissionResult
} from "./contracts.js";
import {
  projectContainer,
  type ContainerProjection,
  type ProjectionOptions
} from "./projection.js";

export interface LedgerOptions {
  readonly accuracy: AccuracyThresholds;
  readonly projection: ProjectionOptions;
}

const defaultLedgerOptions: LedgerOptions = {
  accuracy: defaultAccuracyThresholds,
  projection: { competingObservationSeconds: 120 }
};

export interface EventLedger {
  submit(
    input: unknown,
    context: RequestContext,
    receivedAt?: Date
  ): SubmissionResult | Promise<SubmissionResult>;
  eventsForContainer(
    tenantId: string,
    containerId: string
  ): readonly StoredEvent[] | Promise<readonly StoredEvent[]>;
  eventsForTenant(
    tenantId: string
  ): readonly StoredEvent[] | Promise<readonly StoredEvent[]>;
  projectionForContainer(
    tenantId: string,
    containerId: string
  ): ContainerProjection | null | Promise<ContainerProjection | null>;
  reviewQueue(
    tenantId: string
  ): readonly ContainerProjection[] | Promise<readonly ContainerProjection[]>;
}

export class InMemoryEventLedger implements EventLedger {
  readonly #events: StoredEvent[];
  readonly #options: LedgerOptions;

  public constructor(
    options: Partial<LedgerOptions> = {},
    initialEvents: readonly StoredEvent[] = []
  ) {
    this.#options = {
      accuracy: options.accuracy ?? defaultLedgerOptions.accuracy,
      projection: options.projection ?? defaultLedgerOptions.projection
    };
    this.#events = [...initialEvents];
  }

  public submit(
    input: unknown,
    context: RequestContext,
    receivedAt = new Date()
  ): SubmissionResult {
    const parsed = eventSubmissionSchema.safeParse(input);
    if (!parsed.success) {
      return {
        accepted: false,
        status: "rejected",
        warnings: [],
        errorCode: "InvalidPayload",
        message: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")
      };
    }

    const submission: EventSubmission = parsed.data;
    const canonicalPayload = canonicalJson({ ...context, ...submission });
    const existing = this.#events.find(
      (event) =>
        event.tenantId === context.tenantId && event.eventId === submission.eventId
    );

    if (existing) {
      if (existing.canonicalPayload === canonicalPayload) {
        return {
          accepted: true,
          status: "duplicate",
          event: existing,
          warnings: existing.accuracyFlags
        };
      }

      return {
        accepted: false,
        status: "rejected",
        warnings: [],
        errorCode: "IdempotencyKeyMismatch",
        message: "This event UUID already exists with a different immutable payload."
      };
    }

    const displayLoadCode =
      submission.eventType === "load_assigned" &&
      typeof submission.payload.displayLoadCode === "string"
        ? submission.payload.displayLoadCode.trim().toUpperCase()
        : null;
    const displayCodeCollision =
      displayLoadCode &&
      this.#events.find(
        (event) =>
          event.tenantId === context.tenantId &&
          event.eventType === "load_assigned" &&
          typeof event.payload.displayLoadCode === "string" &&
          event.payload.displayLoadCode.trim().toUpperCase() === displayLoadCode
      );

    if (displayCodeCollision) {
      return {
        accepted: false,
        status: "rejected",
        warnings: [],
        errorCode: "InvalidPayload",
        message: `Load code ${displayLoadCode} is already assigned to another immutable event.`
      };
    }

    const receivedAtIso = receivedAt.toISOString();
    const effectiveAt = effectiveEventAt(
      submission.eventAt,
      submission.deviceClockOffsetSeconds
    );
    const installationEvents = this.#events.filter(
      (event) =>
        event.tenantId === context.tenantId &&
        event.deviceId === context.deviceId &&
        event.deviceInstallationId === submission.deviceInstallationId
    );
    const containerEvents = this.eventsForContainer(
      context.tenantId,
      submission.containerId
    );
    const latestContainerTime = Math.max(
      ...containerEvents.map((event) => Date.parse(event.effectiveAt)),
      Number.NEGATIVE_INFINITY
    );

    const tentativeEvent: StoredEvent = {
      ...submission,
      ...context,
      receivedAt: receivedAtIso,
      effectiveAt,
      accuracyFlags: [],
      canonicalPayload
    };

    const flags = [
      ...assessClock(
        submission.deviceClockOffsetSeconds,
        submission.clockVerifiedAt,
        submission.eventAt,
        this.#options.accuracy
      ),
      ...assessReferenceData(
        submission.referenceDataVersion,
        receivedAtIso,
        this.#options.accuracy
      ),
      ...assessSequence(tentativeEvent, installationEvents)
    ];

    if (Date.parse(effectiveAt) < latestContainerTime) {
      flags.push("LateArrival");
    }

    let event: StoredEvent = {
      ...tentativeEvent,
      accuracyFlags: [...new Set(flags)]
    };

    // A receiving or processing scanner may be the first device to reveal
    // that a container changed sites. That is useful physical evidence, so
    // preserve and apply it, but mark the event when no departure checkpoint
    // precedes it. This keeps the API and PostgreSQL-backed ledger consistent
    // because both use the same deterministic projection rules.
    const candidateProjection = projectContainer(
      [...containerEvents, event],
      this.#options.projection
    );
    const eventConflictFlags = candidateProjection?.conflicts
      .filter((conflict) => conflict.eventIds.includes(event.eventId))
      .flatMap((conflict) => {
        if (conflict.reason === "LocationChangeWithoutDeparture") return ["LocationChangeWithoutDeparture" as const];
        if (conflict.reason === "RepeatedDepartureBeforeArrival") return ["RepeatedDepartureBeforeArrival" as const];
        if (conflict.reason === "ProcessingWithoutReceipt") return ["ProcessingWithoutReceipt" as const];
        return [];
      }) ?? [];
    if (eventConflictFlags.length > 0) {
      event = {
        ...event,
        accuracyFlags: [...new Set([...event.accuracyFlags, ...eventConflictFlags])]
      };
    }
    this.#events.push(event);

    const projection = this.projectionForContainer(
      context.tenantId,
      submission.containerId
    );
    const requiresReview =
      event.accuracyFlags.some(isReviewFlag) || projection?.health === "needs_review";

    return {
      accepted: true,
      status: requiresReview
        ? "accepted_for_review"
        : event.accuracyFlags.length > 0
          ? "accepted_with_warning"
          : "accepted",
      event,
      warnings: event.accuracyFlags
    };
  }

  public eventsForContainer(
    tenantId: string,
    containerId: string
  ): readonly StoredEvent[] {
    return this.#events.filter(
      (event) => event.tenantId === tenantId && event.containerId === containerId
    );
  }

  public eventsForTenant(tenantId: string): readonly StoredEvent[] {
    return this.#events.filter((event) => event.tenantId === tenantId);
  }

  public projectionForContainer(
    tenantId: string,
    containerId: string
  ): ContainerProjection | null {
    return projectContainer(
      this.eventsForContainer(tenantId, containerId),
      this.#options.projection
    );
  }

  public reviewQueue(tenantId: string): readonly ContainerProjection[] {
    const containerIds = new Set(
      this.#events
        .filter((event) => event.tenantId === tenantId)
        .map((event) => event.containerId)
    );

    return [...containerIds]
      .map((containerId) => this.projectionForContainer(tenantId, containerId))
      .filter(
        (projection): projection is ContainerProjection =>
          projection !== null && projection.health === "needs_review"
      );
  }
}
