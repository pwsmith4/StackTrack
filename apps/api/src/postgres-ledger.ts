import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  canonicalJson,
  InMemoryEventLedger,
  projectContainer,
  type ContainerProjection,
  type EventLedger,
  type RequestContext,
  type StoredEvent,
  type SubmissionResult
} from "@stacktrack/domain";
import type {
  LocalContainer,
  LocalDeviceAssignment,
  LocalDevice,
  LocalFixtures,
  LocalLocation
} from "./local-fixtures.js";

interface EventRow extends QueryResultRow {
  event_id: string;
  container_id: string;
  load_code_id: string | null;
  location_id: string;
  device_id: string;
  device_installation_id: string;
  device_sequence: string;
  event_type: StoredEvent["eventType"];
  device_observed_at: Date;
  device_clock_offset_seconds: string | null;
  clock_verified_at: Date | null;
  effective_at: Date;
  received_at: Date;
  reference_data_version: Date | null;
  payload: Record<string, unknown>;
  accuracy_flags: StoredEvent["accuracyFlags"];
}

const eventSelect = `
  SELECT event_id, container_id, load_code_id, location_id, device_id,
    device_installation_id, device_sequence, event_type, device_observed_at,
    device_clock_offset_seconds, clock_verified_at, effective_at, received_at,
    reference_data_version, payload, accuracy_flags
  FROM asset_events
`;

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function storedEvent(tenantId: string, row: EventRow): StoredEvent {
  const submission = {
    eventId: row.event_id,
    deviceInstallationId: row.device_installation_id,
    deviceSequence: Number(row.device_sequence),
    containerId: row.container_id,
    ...(row.load_code_id ? { loadCodeId: row.load_code_id } : {}),
    locationId: row.location_id,
    eventType: row.event_type,
    eventAt: toIso(row.device_observed_at),
    ...(row.device_clock_offset_seconds !== null && row.clock_verified_at
      ? {
          deviceClockOffsetSeconds: Number(row.device_clock_offset_seconds),
          clockVerifiedAt: toIso(row.clock_verified_at)
        }
      : {}),
    ...(row.reference_data_version
      ? { referenceDataVersion: toIso(row.reference_data_version) }
      : {}),
    payload: row.payload
  };
  const context = { tenantId, deviceId: row.device_id };
  return {
    ...submission,
    ...context,
    receivedAt: toIso(row.received_at),
    effectiveAt: toIso(row.effective_at),
    accuracyFlags: row.accuracy_flags,
    canonicalPayload: canonicalJson({ ...context, ...submission })
  };
}

export class PostgresEventLedger implements EventLedger {
  public constructor(private readonly pool: Pool) {}

  private async tenantTransaction<T>(
    tenantId: string,
    action: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenantId
      ]);
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async rowsForTenant(
    client: PoolClient,
    tenantId: string
  ): Promise<StoredEvent[]> {
    const result = await client.query<EventRow>(
      `${eventSelect} WHERE tenant_id = $1 ORDER BY received_at, event_id`,
      [tenantId]
    );
    return result.rows.map((row) => storedEvent(tenantId, row));
  }

  public async submit(
    input: unknown,
    context: RequestContext,
    receivedAt = new Date()
  ): Promise<SubmissionResult> {
    return this.tenantTransaction(context.tenantId, async (client) => {
      const existingEvents = await this.rowsForTenant(client, context.tenantId);
      const validator = new InMemoryEventLedger({}, existingEvents);
      const result = validator.submit(input, context, receivedAt);
      if (!result.accepted || result.status === "duplicate" || !result.event) {
        return result;
      }

      const event = result.event;
      if (event.eventType === "load_assigned" && event.loadCodeId) {
        const goodsType =
          typeof event.payload.goodsType === "string"
            ? event.payload.goodsType
            : "Other";
        const reference = await client.query<{
          goods_type_id: string;
          secondary_field_id: string;
        }>(
          `SELECT goods_type_id, secondary_field_id
             FROM goods_types
            WHERE tenant_id = $1 AND goods_type_name = $2 AND is_active
            LIMIT 1`,
          [context.tenantId, goodsType]
        );
        if (!reference.rows[0]) {
          throw new Error(`Unknown goods type: ${goodsType}`);
        }
        const displayCode =
          typeof event.payload.displayLoadCode === "string"
            ? event.payload.displayLoadCode.trim().toUpperCase()
            : event.loadCodeId;
        const secondaryValue =
          typeof event.payload.secondaryValue === "string"
            ? event.payload.secondaryValue
            : "Unspecified";

        await client.query(
          `INSERT INTO load_codes (
             tenant_id, load_code_id, external_reference, code_source,
             generating_location_id, goods_type_id, secondary_field_id,
             secondary_value, reference_data_version, device_created_at,
             effective_created_at, server_received_at, created_by_device_id
           ) VALUES ($1,$2,$3,'stacktrack',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            context.tenantId,
            event.loadCodeId,
            displayCode,
            event.locationId,
            reference.rows[0].goods_type_id,
            reference.rows[0].secondary_field_id,
            secondaryValue,
            event.referenceDataVersion ?? event.receivedAt,
            event.eventAt,
            event.effectiveAt,
            event.receivedAt,
            event.deviceId
          ]
        );
      }

      await client.query(
        `INSERT INTO asset_events (
           tenant_id, event_id, container_id, load_code_id, location_id,
           device_id, device_installation_id, device_sequence, event_type,
           device_observed_at, device_clock_offset_seconds, clock_verified_at,
           effective_at, received_at, reference_data_version, payload,
           payload_sha256, accuracy_flags, ingestion_disposition
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
         )`,
        [
          event.tenantId,
          event.eventId,
          event.containerId,
          event.loadCodeId ?? null,
          event.locationId,
          event.deviceId,
          event.deviceInstallationId,
          event.deviceSequence,
          event.eventType,
          event.eventAt,
          event.deviceClockOffsetSeconds ?? null,
          event.clockVerifiedAt ?? null,
          event.effectiveAt,
          event.receivedAt,
          event.referenceDataVersion ?? null,
          event.payload,
          createHash("sha256").update(event.canonicalPayload).digest("hex"),
          event.accuracyFlags,
          result.status
        ]
      );

      if (result.status === "accepted_for_review") {
        const evidenceFingerprint = createHash("sha256")
          .update(`${event.containerId}:${event.eventId}:${event.accuracyFlags.join(",")}`)
          .digest("hex");
        await client.query(
          `INSERT INTO review_cases (
             tenant_id, container_id, reason_code, evidence_event_ids,
             evidence_fingerprint, opened_at
           ) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (tenant_id, evidence_fingerprint) DO NOTHING`,
          [
            context.tenantId,
            event.containerId,
            event.accuracyFlags[0] ?? "ProjectionConflict",
            [event.eventId],
            evidenceFingerprint,
            event.receivedAt
          ]
        );
      }
      return result;
    });
  }

  public async eventsForTenant(tenantId: string): Promise<readonly StoredEvent[]> {
    return this.tenantTransaction(tenantId, (client) =>
      this.rowsForTenant(client, tenantId)
    );
  }

  public async eventsForContainer(
    tenantId: string,
    containerId: string
  ): Promise<readonly StoredEvent[]> {
    return this.tenantTransaction(tenantId, async (client) => {
      const result = await client.query<EventRow>(
        `${eventSelect}
          WHERE tenant_id = $1 AND container_id = $2
          ORDER BY received_at, event_id`,
        [tenantId, containerId]
      );
      return result.rows.map((row) => storedEvent(tenantId, row));
    });
  }

  public async projectionForContainer(
    tenantId: string,
    containerId: string
  ): Promise<ContainerProjection | null> {
    return projectContainer(await this.eventsForContainer(tenantId, containerId));
  }

  public async reviewQueue(
    tenantId: string
  ): Promise<readonly ContainerProjection[]> {
    const events = await this.eventsForTenant(tenantId);
    const ids = [...new Set(events.map((event) => event.containerId))];
    return ids
      .map((containerId) =>
        projectContainer(events.filter((event) => event.containerId === containerId))
      )
      .filter(
        (projection): projection is ContainerProjection =>
          projection !== null && projection.health === "needs_review"
      );
  }

  public async referenceData(tenantId: string): Promise<LocalFixtures | null> {
    return this.tenantTransaction(tenantId, async (client) => {
      const tenant = await client.query<{ tenant_id: string; tenant_name: string }>(
        `SELECT tenant_id, tenant_name FROM tenants WHERE tenant_id = $1`,
        [tenantId]
      );
      if (!tenant.rows[0]) return null;

      const [locations, devices, deviceAssignments, containers, goodsTypes] = await Promise.all([
        client.query<LocalLocation>(
          `SELECT location_id AS "locationId", location_name AS name,
                  location_type AS type
             FROM locations WHERE tenant_id = $1 AND is_active
             ORDER BY location_type, location_name`,
          [tenantId]
        ),
        client.query<LocalDevice>(
          `SELECT d.device_id AS "deviceId",
                  di.installation_id AS "installationId",
                  d.device_label AS label,
                  d.assigned_location_id AS "assignedLocationId",
                  d.is_active AS "isActive",
                  d.deactivated_at AS "deactivatedAt",
                  di.pending_offline_scan_count AS "pendingOfflineScanCount",
                  di.reported_app_version AS "reportedAppVersion",
                  d.required_app_version AS "requiredAppVersion",
                  di.last_reported_at AS "lastReportedAt"
             FROM devices d
             JOIN device_installations di
               ON di.tenant_id = d.tenant_id AND di.device_id = d.device_id
            WHERE d.tenant_id = $1 AND di.is_active
            ORDER BY d.device_label`,
          [tenantId]
        ),
        client.query<LocalDeviceAssignment>(
          `SELECT assignment_history_id AS "assignmentHistoryId",
                  device_id AS "deviceId",
                  previous_location_id AS "previousLocationId",
                  assigned_location_id AS "assignedLocationId",
                  reason,
                  occurred_at AS "occurredAt"
             FROM device_assignment_history
            WHERE tenant_id = $1
            ORDER BY occurred_at DESC`,
          [tenantId]
        ),
        client.query<LocalContainer>(
          `SELECT c.container_id AS "containerId", c.container_label AS label,
                  ct.type_name AS type
             FROM containers c
             JOIN container_types ct
               ON ct.tenant_id = c.tenant_id
              AND ct.container_type_id = c.container_type_id
            WHERE c.tenant_id = $1 AND c.is_active
            ORDER BY c.container_label`,
          [tenantId]
        ),
        client.query<{
          name: string;
          secondaryLabel: string;
          options: string[];
        }>(
          `SELECT gt.goods_type_name AS name,
                  sf.secondary_field_name AS "secondaryLabel",
                  sf.options AS options
             FROM goods_types gt
             JOIN secondary_fields sf
               ON sf.tenant_id = gt.tenant_id
              AND sf.secondary_field_id = gt.secondary_field_id
            WHERE gt.tenant_id = $1 AND gt.is_active
            ORDER BY gt.sort_order, gt.goods_type_name`,
          [tenantId]
        )
      ]);

      return {
        tenant: {
          tenantId: tenant.rows[0].tenant_id,
          name: tenant.rows[0].tenant_name
        },
        locations: locations.rows,
        devices: devices.rows,
        deviceAssignments: deviceAssignments.rows,
        containers: containers.rows,
        goodsTypes: goodsTypes.rows
      };
    });
  }
}
