import { z } from "zod";

export const eventTypes = [
  "load_assigned",
  "batch_out",
  "batch_in",
  "emptied"
] as const;

export const eventTypeSchema = z.enum(eventTypes);
export type EventType = z.infer<typeof eventTypeSchema>;

export const eventSubmissionSchema = z
  .object({
    eventId: z.string().uuid(),
    deviceInstallationId: z.string().uuid(),
    deviceSequence: z.number().int().nonnegative(),
    containerId: z.string().uuid(),
    loadCodeId: z.string().uuid().nullable().optional(),
    locationId: z.string().uuid(),
    eventType: eventTypeSchema,
    eventAt: z.string().datetime({ offset: true }),
    deviceClockOffsetSeconds: z.number().finite().optional(),
    clockVerifiedAt: z.string().datetime({ offset: true }).optional(),
    referenceDataVersion: z.string().datetime({ offset: true }).optional(),
    payload: z.record(z.unknown()).default({})
  })
  .superRefine((value, context) => {
    if (value.eventType === "load_assigned" && !value.loadCodeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loadCodeId"],
        message: "loadCodeId is required for load_assigned"
      });
    }

    if (value.eventType === "emptied" && value.loadCodeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loadCodeId"],
        message: "loadCodeId must be omitted for emptied"
      });
    }

    // A scanner at the departure site cannot know which facility will receive
    // the truck.  The receiving event's locationId is the only authoritative
    // destination, so reject destination fields from every event payload
    // rather than allowing an old client to re-introduce a planned route.
    if (Object.prototype.hasOwnProperty.call(value.payload, "destinationLocationId")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "destinationLocationId"],
        message:
          "A departure scan records only where the container left. Do not include a receiving site or planned destination; a later arrival scan, if one occurs, provides that location."
      });
    }

    if (
      (value.deviceClockOffsetSeconds === undefined) !==
      (value.clockVerifiedAt === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deviceClockOffsetSeconds"],
        message:
          "deviceClockOffsetSeconds and clockVerifiedAt must be supplied together"
      });
    }
  });

export type EventSubmission = z.infer<typeof eventSubmissionSchema>;

export const requestContextSchema = z.object({
  tenantId: z.string().uuid(),
  deviceId: z.string().uuid()
});

export type RequestContext = z.infer<typeof requestContextSchema>;

export const accuracyFlags = [
  "ClockSkewWarning",
  "ClockSkewReview",
  "ClockVerificationStale",
  "LateArrival",
  "DeviceSequenceGap",
  "DeviceSequenceOutOfOrder",
  "DeviceSequenceCollision",
  "StaleReferenceData"
] as const;

export type AccuracyFlag = (typeof accuracyFlags)[number];

export const accuracyFlagSchema = z.enum(accuracyFlags);

export interface StoredEvent extends EventSubmission, RequestContext {
  readonly receivedAt: string;
  readonly effectiveAt: string;
  readonly accuracyFlags: readonly AccuracyFlag[];
  readonly canonicalPayload: string;
}

export const storedEventSchema = eventSubmissionSchema
  .and(requestContextSchema)
  .and(
    z.object({
      receivedAt: z.string().datetime({ offset: true }),
      effectiveAt: z.string().datetime({ offset: true }),
      accuracyFlags: z.array(accuracyFlagSchema),
      canonicalPayload: z.string().min(1)
    })
  );

export type SubmissionStatus =
  | "accepted"
  | "accepted_with_warning"
  | "accepted_for_review"
  | "duplicate"
  | "rejected";

export type SubmissionErrorCode =
  | "InvalidPayload"
  | "IdempotencyKeyMismatch";

export interface SubmissionResult {
  readonly accepted: boolean;
  readonly status: SubmissionStatus;
  readonly event?: StoredEvent;
  readonly warnings: readonly AccuracyFlag[];
  readonly errorCode?: SubmissionErrorCode;
  readonly message?: string;
}
