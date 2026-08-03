import type { Pool, PoolClient } from "pg";

export const devicePermissionKeys = [
  "reference_data.read",
  "observation.create",
  "load_code.lookup",
  "telemetry.report"
] as const;

export type DevicePermissionKey = (typeof devicePermissionKeys)[number];

export interface DeviceControlUpdate {
  readonly label?: string;
  readonly assignedLocationId?: string;
  readonly isActive?: boolean;
  readonly requiredAppVersion?: string;
  readonly assignmentReason?: string;
}

export interface DeviceTelemetryUpdate {
  readonly installationId: string;
  readonly appVersion: string;
  readonly pendingOfflineScanCount: number;
}

export interface DeviceAdministrationActor {
  readonly userId: string;
  /** Cross-location scanner moves are a corporate governance action. */
  readonly role?: "organization_owner" | "operations_administrator" | "location_manager" | "read_only_reviewer" | "support";
}

export interface DeviceControlResult {
  readonly deviceId: string;
  readonly assignedLocationId: string;
  readonly isActive: boolean;
  readonly deactivatedAt: string | null;
  readonly pendingOfflineScanCount: number;
  readonly reportedAppVersion: string | null;
  readonly requiredAppVersion: string;
  readonly lastReportedAt: string | null;
}

export interface DeviceAdministration {
  update(
    tenantId: string,
    deviceId: string,
    update: DeviceControlUpdate,
    actor?: DeviceAdministrationActor
  ): Promise<DeviceControlResult | null>;
  reportTelemetry(
    tenantId: string,
    deviceId: string,
    update: DeviceTelemetryUpdate
  ): Promise<DeviceControlResult | null>;
  isScannerEnabled(
    tenantId: string,
    deviceId: string,
    installationId: string
  ): Promise<boolean>;
  /**
   * Returns the authoritative operating location for an active installation.
   * Event ingestion uses this to prevent a scanner from claiming observations
   * for a different site.  It is optional for lightweight test doubles and
   * older local adapters; the production Postgres adapter implements it.
   */
  assignedLocationId?(
    tenantId: string,
    deviceId: string,
    installationId: string
  ): Promise<string | null>;
  /** Returns true only when the active installation's named role grants key. */
  hasPermission?(
    tenantId: string,
    deviceId: string,
    installationId: string,
    permissionKey: DevicePermissionKey
  ): Promise<boolean>;
  /** Resolve the complete named permission set for the active installation. */
  permissionKeys?(
    tenantId: string,
    deviceId: string,
    installationId: string
  ): Promise<readonly DevicePermissionKey[]>;
}

export class PostgresDeviceAdministration implements DeviceAdministration {
  public constructor(private readonly pool: Pool) {}

  private async tenantTransaction<T>(
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

  public async update(
    tenantId: string,
    deviceId: string,
    update: DeviceControlUpdate,
    actor?: DeviceAdministrationActor
  ): Promise<DeviceControlResult | null> {
    return this.tenantTransaction(tenantId, async (client) => {
      const current = await client.query<{
        device_label: string;
        assigned_location_id: string;
        is_active: boolean;
        deactivated_at: Date | null;
        required_app_version: string;
      }>(
        `SELECT device_label, assigned_location_id, is_active, deactivated_at, required_app_version
           FROM devices
          WHERE tenant_id = $1 AND device_id = $2
          FOR UPDATE`,
        [tenantId, deviceId]
      );
      if (!current.rows[0]) return null;

      const label = update.label === undefined ? current.rows[0].device_label : update.label.trim();
      if (label.length < 2) throw new Error("Scanner name must contain at least 2 characters.");
      const assignedLocationId = update.assignedLocationId ?? current.rows[0].assigned_location_id;
      const isActive = update.isActive ?? current.rows[0].is_active;
      const requiredAppVersion = update.requiredAppVersion === undefined
        ? current.rows[0].required_app_version
        : update.requiredAppVersion.trim();
      const changedLabel = label !== current.rows[0].device_label;
      const changedLocation = assignedLocationId !== current.rows[0].assigned_location_id;
      const changedAvailability = isActive !== current.rows[0].is_active;
      const changedRequiredVersion = requiredAppVersion !== current.rows[0].required_app_version;

      // Keep the corporate approval boundary in the persistence layer as well
      // as the HTTP layer. This prevents a future caller from accidentally
      // bypassing the owner-only rule when the reference-data cache is stale.
      if (changedLocation && actor && actor.role !== "organization_owner") {
        throw new Error("Cross-location scanner moves require an Organization Owner approval.");
      }

      // The pilot lets an administrator make a routine scanner move without a
      // written reason, while preserving a truthful audit record either way.
      const assignmentReason = update.assignmentReason?.trim() || "No reason provided";
      if (assignmentReason.length > 1200) {
        throw new Error("Scanner move reason cannot exceed 1200 characters.");
      }

      if (!changedLabel && !changedLocation && !changedAvailability && !changedRequiredVersion) {
        const installation = await client.query<{
          pending_offline_scan_count: number;
          reported_app_version: string | null;
          last_reported_at: Date | null;
        }>(
          `SELECT pending_offline_scan_count, reported_app_version, last_reported_at
             FROM device_installations
            WHERE tenant_id = $1 AND device_id = $2 AND is_active
            ORDER BY installed_at DESC
            LIMIT 1`,
          [tenantId, deviceId]
        );
        return {
          deviceId,
          assignedLocationId,
          isActive,
          deactivatedAt: current.rows[0].deactivated_at?.toISOString() ?? null,
          pendingOfflineScanCount: Number(installation.rows[0]?.pending_offline_scan_count ?? 0),
          reportedAppVersion: installation.rows[0]?.reported_app_version ?? null,
          requiredAppVersion,
          lastReportedAt: installation.rows[0]?.last_reported_at?.toISOString() ?? null
        };
      }

      const location = await client.query(
        `SELECT 1 FROM locations
          WHERE tenant_id = $1 AND location_id = $2 AND is_active`,
        [tenantId, assignedLocationId]
      );
      if (!location.rows[0]) {
        throw new Error("Assigned location is not available for this tenant.");
      }

      const updated = await client.query<{
        device_id: string;
        assigned_location_id: string;
        is_active: boolean;
        deactivated_at: Date | null;
        required_app_version: string;
      }>(
        `UPDATE devices
            SET device_label = $3,
                assigned_location_id = $4,
                is_active = $5,
                deactivated_at = CASE WHEN $5 THEN NULL ELSE clock_timestamp() END,
                required_app_version = $6
          WHERE tenant_id = $1 AND device_id = $2
        RETURNING device_id, assigned_location_id, is_active, deactivated_at, required_app_version`,
        [tenantId, deviceId, label, assignedLocationId, isActive, requiredAppVersion]
      );
      const row = updated.rows[0]!;

      if (changedLocation) {
        await client.query(
          `INSERT INTO device_assignment_history
            (tenant_id, device_id, previous_location_id, assigned_location_id, reason, actor_type, actor_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tenantId, deviceId, current.rows[0].assigned_location_id, assignedLocationId, assignmentReason, actor ? "user" : "system", actor?.userId ?? null]
        );
      }

      await client.query(
        `INSERT INTO audit_log
          (tenant_id, actor_type, actor_id, action, target_type, target_id, details)
         VALUES ($1, $2, $3, $4, 'device', $5, $6::jsonb)`,
        [
          tenantId,
          actor ? "user" : "system",
          actor?.userId ?? null,
          changedLabel && changedLocation
            ? "device.renamed_and_reassigned"
            : changedLocation && changedAvailability
              ? "device.reassigned_and_availability_changed"
              : changedLocation
                ? "device.reassigned"
                : changedLabel && changedAvailability
                  ? "device.renamed_and_availability_changed"
                  : changedLabel
                    ? "device.renamed"
                    : changedAvailability
                      ? isActive ? "device.enabled" : "device.disabled"
                      : changedRequiredVersion
                        ? "device.required_version_changed"
                        : "device.updated",
          deviceId,
          JSON.stringify({
            before: current.rows[0],
            after: { label, assignedLocationId, isActive, requiredAppVersion },
            ...(changedLocation ? { assignmentReason } : {}),
            source: "pilot_admin_console"
          })
        ]
      );

      const installation = await client.query<{
        pending_offline_scan_count: number;
        reported_app_version: string | null;
        last_reported_at: Date | null;
      }>(
        `SELECT pending_offline_scan_count, reported_app_version, last_reported_at
           FROM device_installations
          WHERE tenant_id = $1 AND device_id = $2 AND is_active
          ORDER BY installed_at DESC
          LIMIT 1`,
        [tenantId, deviceId]
      );

      return {
        deviceId: row.device_id,
        assignedLocationId: row.assigned_location_id,
        isActive: row.is_active,
        deactivatedAt: row.deactivated_at?.toISOString() ?? null,
        pendingOfflineScanCount: Number(installation.rows[0]?.pending_offline_scan_count ?? 0),
        reportedAppVersion: installation.rows[0]?.reported_app_version ?? null,
        requiredAppVersion: row.required_app_version,
        lastReportedAt: installation.rows[0]?.last_reported_at?.toISOString() ?? null
      };
    });
  }

  public async reportTelemetry(tenantId: string, deviceId: string, update: DeviceTelemetryUpdate): Promise<DeviceControlResult | null> {
    return this.tenantTransaction(tenantId, async (client) => {
      const result = await client.query<{
        device_id: string;
        assigned_location_id: string;
        is_active: boolean;
        deactivated_at: Date | null;
        required_app_version: string;
        pending_offline_scan_count: number;
        reported_app_version: string | null;
        last_reported_at: Date | null;
      }>(
        `UPDATE device_installations di
            SET last_reported_at = clock_timestamp(),
                reported_app_version = $4,
                pending_offline_scan_count = $5
           FROM devices d
          WHERE di.tenant_id = $1
            AND di.device_id = $2
            AND di.installation_id = $3
            AND di.is_active
            AND d.tenant_id = di.tenant_id
            AND d.device_id = di.device_id
        RETURNING d.device_id, d.assigned_location_id, d.is_active, d.deactivated_at,
                  d.required_app_version, di.pending_offline_scan_count,
                  di.reported_app_version, di.last_reported_at`,
        [tenantId, deviceId, update.installationId, update.appVersion, update.pendingOfflineScanCount]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        deviceId: row.device_id,
        assignedLocationId: row.assigned_location_id,
        isActive: row.is_active,
        deactivatedAt: row.deactivated_at?.toISOString() ?? null,
        pendingOfflineScanCount: row.pending_offline_scan_count,
        reportedAppVersion: row.reported_app_version,
        requiredAppVersion: row.required_app_version,
        lastReportedAt: row.last_reported_at?.toISOString() ?? null
      };
    });
  }

  public async isScannerEnabled(
    tenantId: string,
    deviceId: string,
    installationId: string
  ): Promise<boolean> {
    return this.tenantTransaction(tenantId, async (client) => {
      const result = await client.query(
        `SELECT 1
           FROM devices d
           JOIN device_installations di
             ON di.tenant_id = d.tenant_id AND di.device_id = d.device_id
          WHERE d.tenant_id = $1
            AND d.device_id = $2
            AND di.installation_id = $3
            AND d.is_active
            AND di.is_active`,
        [tenantId, deviceId, installationId]
      );
      return result.rowCount === 1;
    });
  }

  public async assignedLocationId(
    tenantId: string,
    deviceId: string,
    installationId: string
  ): Promise<string | null> {
    return this.tenantTransaction(tenantId, async (client) => {
      const result = await client.query<{ assigned_location_id: string }>(
        `SELECT d.assigned_location_id
           FROM devices d
           JOIN device_installations di
             ON di.tenant_id = d.tenant_id AND di.device_id = d.device_id
          WHERE d.tenant_id = $1
            AND d.device_id = $2
            AND di.installation_id = $3
            AND d.is_active
            AND di.is_active
          LIMIT 1`,
        [tenantId, deviceId, installationId]
      );
      return result.rows[0]?.assigned_location_id ?? null;
    });
  }

  public async hasPermission(
    tenantId: string,
    deviceId: string,
    installationId: string,
    permissionKey: DevicePermissionKey
  ): Promise<boolean> {
    return this.tenantTransaction(tenantId, async (client) => {
      const result = await client.query(
        `SELECT 1
           FROM device_installations di
           JOIN devices d
             ON d.tenant_id = di.tenant_id AND d.device_id = di.device_id
           JOIN device_roles dr
             ON dr.tenant_id = di.tenant_id AND dr.role_key = di.device_role
           JOIN device_role_permissions drp
             ON drp.tenant_id = dr.tenant_id AND drp.role_key = dr.role_key
          WHERE di.tenant_id = $1
            AND di.device_id = $2
            AND di.installation_id = $3
            AND di.is_active
            AND d.is_active
            AND dr.is_active
            AND drp.permission_key = $4
          LIMIT 1`,
        [tenantId, deviceId, installationId, permissionKey]
      );
      return result.rowCount === 1;
    });
  }

  public async permissionKeys(
    tenantId: string,
    deviceId: string,
    installationId: string
  ): Promise<readonly DevicePermissionKey[]> {
    return this.tenantTransaction(tenantId, async (client) => {
      const result = await client.query<{ permission_key: DevicePermissionKey }>(
        `SELECT drp.permission_key
           FROM device_installations di
           JOIN devices d
             ON d.tenant_id = di.tenant_id AND d.device_id = di.device_id
           JOIN device_roles dr
             ON dr.tenant_id = di.tenant_id AND dr.role_key = di.device_role
           JOIN device_role_permissions drp
             ON drp.tenant_id = dr.tenant_id AND drp.role_key = dr.role_key
          WHERE di.tenant_id = $1
            AND di.device_id = $2
            AND di.installation_id = $3
            AND di.is_active
            AND d.is_active
            AND dr.is_active
          ORDER BY drp.permission_key` ,
        [tenantId, deviceId, installationId]
      );
      return result.rows.map((row) => row.permission_key);
    });
  }
}
