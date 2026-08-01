import type { ContainerProjection, LoadState } from "@stacktrack/domain";
import type { Pool, PoolClient } from "pg";
import type { AdminPrincipal } from "./admin-access.js";

export type CorrectionImpact = "routine" | "material";
export type CorrectionAction = "approved" | "rejected" | "reopened";
export type CorrectionStatus = "pending" | CorrectionAction;

export interface ProposedCorrection {
  readonly locationId?: string;
  readonly loadState?: LoadState;
}

export interface NewCorrectionRequest {
  readonly containerId: string;
  readonly impactLevel: CorrectionImpact;
  readonly reason: string;
  readonly proposedCorrection: ProposedCorrection;
}

export interface CorrectionRequest {
  readonly correctionRequestId: string;
  readonly containerId: string;
  readonly containerLabel: string;
  readonly requestedByUserId: string;
  readonly requestedByDisplayName: string;
  readonly impactLevel: CorrectionImpact;
  readonly reason: string;
  readonly proposedCorrection: ProposedCorrection;
  readonly requestedAt: string;
  readonly status: CorrectionStatus;
  readonly latestActionAt: string | null;
  readonly latestActionReason: string | null;
  readonly latestActorDisplayName: string | null;
  readonly actionCount: number;
}

export interface AdministrativeCorrection {
  readonly correctionRequestId: string;
  readonly approvedAt: string;
  readonly approvedByDisplayName: string;
  readonly reason: string;
}

export type CorrectedContainerProjection = ContainerProjection & {
  readonly administrativeCorrection?: AdministrativeCorrection;
};

export interface CorrectionAdministration {
  listRequests(tenantId: string): Promise<CorrectionRequest[]>;
  createRequest(
    tenantId: string,
    actor: AdminPrincipal,
    input: NewCorrectionRequest
  ): Promise<CorrectionRequest>;
  takeAction(
    tenantId: string,
    actor: AdminPrincipal,
    correctionRequestId: string,
    action: CorrectionAction,
    reason: string
  ): Promise<CorrectionRequest>;
  applyApprovedCorrections(
    tenantId: string,
    projections: readonly ContainerProjection[]
  ): Promise<CorrectedContainerProjection[]>;
}

function toIso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function validateReason(reasonInput: string, label: string): string {
  const reason = reasonInput.trim();
  if (reason.length < 8 || reason.length > 1200) {
    throw new Error(`${label} needs a clear reason of 8-1200 characters.`);
  }
  return reason;
}

function validateProposedCorrection(input: ProposedCorrection): ProposedCorrection {
  const keys = Object.keys(input);
  if (
    keys.length === 0 ||
    keys.some((key) => key !== "locationId" && key !== "loadState")
  ) {
    throw new Error("Choose a supported state or location correction.");
  }
  if (
    input.locationId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.locationId
    )
  ) {
    throw new Error("Choose a valid StackTrack location.");
  }
  if (
    input.loadState !== undefined &&
    !["unknown", "empty", "loaded"].includes(input.loadState)
  ) {
    throw new Error("Choose a valid container state.");
  }
  return {
    ...(input.locationId ? { locationId: input.locationId } : {}),
    ...(input.loadState ? { loadState: input.loadState } : {})
  };
}

export class PostgresCorrectionAdministration implements CorrectionAdministration {
  public constructor(private readonly pool: Pool) {}

  private async transaction<T>(
    tenantId: string,
    action: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
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

  private map(row: Record<string, unknown>): CorrectionRequest {
    const latestAction = row.latest_action ? String(row.latest_action) : null;
    return {
      correctionRequestId: String(row.correction_request_id),
      containerId: String(row.container_id),
      containerLabel: String(row.container_label),
      requestedByUserId: String(row.requested_by_user_id),
      requestedByDisplayName: row.requested_by_display_name
        ? String(row.requested_by_display_name)
        : "Unknown administrator",
      impactLevel: row.impact_level as CorrectionImpact,
      reason: String(row.reason),
      proposedCorrection: (row.proposed_correction ?? {}) as ProposedCorrection,
      requestedAt: toIso(row.requested_at as Date | string)!,
      status: latestAction === "reopened"
        ? "pending"
        : (latestAction ?? "pending") as CorrectionStatus,
      latestActionAt: toIso(row.latest_action_at as Date | string | null),
      latestActionReason: row.latest_action_reason
        ? String(row.latest_action_reason)
        : null,
      latestActorDisplayName: row.latest_actor_display_name
        ? String(row.latest_actor_display_name)
        : null,
      actionCount: Number(row.action_count ?? 0)
    };
  }

  private async select(
    client: PoolClient,
    tenantId: string,
    correctionRequestId?: string
  ): Promise<CorrectionRequest[]> {
    const result = await client.query(
      `SELECT cr.correction_request_id, cr.container_id, c.container_label,
              cr.requested_by_user_id, requester.display_name AS requested_by_display_name,
              cr.impact_level, cr.reason, cr.proposed_correction, cr.requested_at,
              latest.action::text AS latest_action, latest.occurred_at AS latest_action_at,
              latest.reason AS latest_action_reason,
              latest_actor.display_name AS latest_actor_display_name,
              action_summary.action_count
         FROM correction_requests cr
         JOIN containers c
           ON c.tenant_id=cr.tenant_id AND c.container_id=cr.container_id
         LEFT JOIN admin_users requester
           ON requester.tenant_id=cr.tenant_id AND requester.user_id=cr.requested_by_user_id
         LEFT JOIN LATERAL (
           SELECT action, actor_user_id, occurred_at, reason
             FROM correction_actions
            WHERE tenant_id=cr.tenant_id
              AND correction_request_id=cr.correction_request_id
            ORDER BY occurred_at DESC, correction_action_id DESC
            LIMIT 1
         ) latest ON true
         LEFT JOIN admin_users latest_actor
           ON latest_actor.tenant_id=cr.tenant_id AND latest_actor.user_id=latest.actor_user_id
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS action_count
             FROM correction_actions
            WHERE tenant_id=cr.tenant_id
              AND correction_request_id=cr.correction_request_id
         ) action_summary ON true
        WHERE cr.tenant_id=$1
          ${correctionRequestId ? "AND cr.correction_request_id=$2" : ""}
        ORDER BY COALESCE(latest.occurred_at, cr.requested_at) DESC, cr.requested_at DESC`,
      correctionRequestId ? [tenantId, correctionRequestId] : [tenantId]
    );
    return result.rows.map((row) => this.map(row));
  }

  public async listRequests(tenantId: string): Promise<CorrectionRequest[]> {
    return this.transaction(tenantId, (client) => this.select(client, tenantId));
  }

  public async createRequest(
    tenantId: string,
    actor: AdminPrincipal,
    input: NewCorrectionRequest
  ): Promise<CorrectionRequest> {
    if (
      actor.role !== "organization_owner" &&
      actor.role !== "operations_administrator" &&
      actor.role !== "location_manager"
    ) {
      throw new Error("Your administrator role cannot request official-state corrections.");
    }
    const reason = validateReason(input.reason, "A correction request");
    if (!["routine", "material"].includes(input.impactLevel)) {
      throw new Error("Choose whether this correction is routine or material.");
    }
    const proposedCorrection = validateProposedCorrection(input.proposedCorrection);

    return this.transaction(tenantId, async (client) => {
      const container = await client.query(
        `SELECT 1
           FROM containers c
          WHERE c.tenant_id=$1 AND c.container_id=$2
            AND EXISTS (
              SELECT 1 FROM asset_events e
               WHERE e.tenant_id=c.tenant_id AND e.container_id=c.container_id
            )`,
        [tenantId, input.containerId]
      );
      if (!container.rows[0]) {
        throw new Error("The container must have scan evidence before its state can be corrected.");
      }
      if (actor.role === "location_manager") {
        const scope = new Set(actor.locationIds ?? []);
        if (scope.size === 0) {
          throw new Error("This Location Manager has no active location assignment.");
        }
        const latest = await client.query<{ location_id: string }>(
          `SELECT location_id
             FROM asset_events
            WHERE tenant_id=$1 AND container_id=$2
            ORDER BY effective_at DESC, received_at DESC, event_id DESC
            LIMIT 1`,
          [tenantId, input.containerId]
        );
        if (!latest.rows[0] || !scope.has(latest.rows[0].location_id)) {
          throw new Error("Location Managers can only request corrections for containers currently associated with an assigned location.");
        }
      }
      if (proposedCorrection.locationId) {
        const location = await client.query(
          `SELECT 1 FROM locations
            WHERE tenant_id=$1 AND location_id=$2 AND is_active`,
          [tenantId, proposedCorrection.locationId]
        );
        if (!location.rows[0]) throw new Error("The proposed location is not active.");
        if (actor.role === "location_manager" && !new Set(actor.locationIds ?? []).has(proposedCorrection.locationId)) {
          throw new Error("A Location Manager can only propose a location within their assigned scope.");
        }
      }

      const inserted = await client.query<{ correction_request_id: string }>(
        `INSERT INTO correction_requests (
           tenant_id, container_id, requested_by_user_id, impact_level,
           reason, proposed_correction
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         RETURNING correction_request_id`,
        [
          tenantId,
          input.containerId,
          actor.userId,
          input.impactLevel,
          reason,
          JSON.stringify(proposedCorrection)
        ]
      );
      const correctionRequestId = inserted.rows[0]!.correction_request_id;
      await client.query(
        `INSERT INTO audit_log (
           tenant_id, actor_type, actor_id, action, target_type, target_id, details
         ) VALUES ($1,'user',$2,'correction.requested','correction_request',$3,$4::jsonb)`,
        [
          tenantId,
          actor.userId,
          correctionRequestId,
          JSON.stringify({
            containerId: input.containerId,
            impactLevel: input.impactLevel,
            reason,
            proposedCorrection,
            source: "admin_console"
          })
        ]
      );
      return (await this.select(client, tenantId, correctionRequestId))[0]!;
    });
  }

  public async takeAction(
    tenantId: string,
    actor: AdminPrincipal,
    correctionRequestId: string,
    action: CorrectionAction,
    reasonInput: string
  ): Promise<CorrectionRequest> {
    if (actor.role !== "organization_owner") {
      throw new Error("Only an Organization Owner can decide official-state corrections.");
    }
    const reason = validateReason(reasonInput, "A correction decision");
    if (!["approved", "rejected", "reopened"].includes(action)) {
      throw new Error("Choose a valid correction decision.");
    }

    return this.transaction(tenantId, async (client) => {
      // Serialize decisions for one request without asking the restricted
      // application role for UPDATE permission on an append-only table.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [tenantId, correctionRequestId]
      );
      const found = await client.query<{
        requested_by_user_id: string;
        impact_level: CorrectionImpact;
      }>(
        `SELECT requested_by_user_id, impact_level
           FROM correction_requests
          WHERE tenant_id=$1 AND correction_request_id=$2`,
        [tenantId, correctionRequestId]
      );
      const request = found.rows[0];
      if (!request) throw new Error("Correction request was not found.");

      const latest = await client.query<{ action: CorrectionAction }>(
        `SELECT action::text AS action
           FROM correction_actions
          WHERE tenant_id=$1 AND correction_request_id=$2
          ORDER BY occurred_at DESC, correction_action_id DESC
          LIMIT 1`,
        [tenantId, correctionRequestId]
      );
      const currentAction = latest.rows[0]?.action;
      const isClosed = currentAction === "approved" || currentAction === "rejected";
      if (action === "reopened" && !isClosed) {
        throw new Error("Only a decided correction can be reopened.");
      }
      if (action !== "reopened" && isClosed) {
        throw new Error("Reopen the correction before recording another decision.");
      }
      if (
        action === "approved" &&
        request.impact_level === "material" &&
        request.requested_by_user_id === actor.userId
      ) {
        throw new Error(
          "Material corrections require approval from a different Organization Owner."
        );
      }

      await client.query(
        `INSERT INTO correction_actions (
           tenant_id, correction_request_id, action, actor_user_id, reason
         ) VALUES ($1,$2,$3,$4,$5)`,
        [tenantId, correctionRequestId, action, actor.userId, reason]
      );
      await client.query(
        `INSERT INTO audit_log (
           tenant_id, actor_type, actor_id, action, target_type, target_id, details
         ) VALUES ($1,'user',$2,$3,'correction_request',$4,$5::jsonb)`,
        [
          tenantId,
          actor.userId,
          `correction.${action}`,
          correctionRequestId,
          JSON.stringify({ reason, source: "admin_console" })
        ]
      );
      return (await this.select(client, tenantId, correctionRequestId))[0]!;
    });
  }

  public async applyApprovedCorrections(
    tenantId: string,
    projections: readonly ContainerProjection[]
  ): Promise<CorrectedContainerProjection[]> {
    if (projections.length === 0) return [];
    return this.transaction(tenantId, async (client) => {
      const result = await client.query<{
        correction_request_id: string;
        container_id: string;
        proposed_correction: ProposedCorrection;
        approved_at: Date | string;
        approved_reason: string;
        approved_by_display_name: string | null;
      }>(
        `SELECT DISTINCT ON (cr.container_id)
                cr.correction_request_id, cr.container_id, cr.proposed_correction,
                latest.occurred_at AS approved_at, latest.reason AS approved_reason,
                approver.display_name AS approved_by_display_name
           FROM correction_requests cr
           JOIN LATERAL (
             SELECT action, actor_user_id, occurred_at, reason
               FROM correction_actions
              WHERE tenant_id=cr.tenant_id
                AND correction_request_id=cr.correction_request_id
              ORDER BY occurred_at DESC, correction_action_id DESC
              LIMIT 1
           ) latest ON latest.action='approved'
           LEFT JOIN admin_users approver
             ON approver.tenant_id=cr.tenant_id AND approver.user_id=latest.actor_user_id
          WHERE cr.tenant_id=$1
          ORDER BY cr.container_id, latest.occurred_at DESC, cr.correction_request_id DESC`,
        [tenantId]
      );
      const corrections = new Map(result.rows.map((row) => [row.container_id, row]));
      return projections.map((projection) => {
        const correction = corrections.get(projection.containerId);
        if (
          !correction ||
          (projection.lastReceivedAt &&
            Date.parse(projection.lastReceivedAt) >= Date.parse(String(correction.approved_at)))
        ) {
          return projection;
        }
        const proposed = correction.proposed_correction ?? {};
        return {
          ...projection,
          ...(proposed.locationId ? { locationId: proposed.locationId } : {}),
          ...(proposed.loadState
            ? {
                loadState: proposed.loadState,
                ...(proposed.loadState !== "loaded" ? { activeLoadCodeId: null } : {})
              }
            : {}),
          administrativeCorrection: {
            correctionRequestId: correction.correction_request_id,
            approvedAt: toIso(correction.approved_at)!,
            approvedByDisplayName:
              correction.approved_by_display_name ?? "Organization Owner",
            reason: correction.approved_reason
          }
        };
      });
    });
  }
}
