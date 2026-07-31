import type { Pool, PoolClient } from "pg";

export interface DeviceControlUpdate {
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
    update: DeviceControlUpdate
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
    update: DeviceControlUpdate
  ): Promise<DeviceControlResult | null> {
    return this.tenantTransaction(tenantId, async (client) => {
      const current = await client.query<{
        assigned_location_id: string;
        is_active: boolean;
        required_app_version: string;
      }>(
        `SELECT assigned_location_id, is_active, required_app_version
           FROM devices
          WHERE tenant_id = $1 AND device_id = $2
          FOR UPDATE`,
        [tenantId, deviceId]
      );
      if (!current.rows[0]) return null;

      const assignedLocationId = update.assignedLocationId ?? current.rows[0].assigned_location_id;
      const isActive = update.isActive ?? current.rows[0].is_active;
      const requiredAppVersion = update.requiredAppVersion ?? current.rows[0].required_app_version;
      const changedLocation = assignedLocationId !== current.rows[0].assigned_location_id;
      const changedAvailability = isActive !== current.rows[0].is_active;
      const changedRequiredVersion = requiredAppVersion !== current.rows[0].required_app_version;

      if (changedLocation && (!update.assignmentReason || update.assignmentReason.trim().length < 5)) {
        throw new Error("A reassignment reason of at least 5 characters is required.");
      }

      if (!changedLocation && !changedAvailability && !changedRequiredVersion) {
        return {
          deviceId,
          assignedLocationId,
          isActive,
          deactivatedAt: null,
          pendingOfflineScanCount: 0,
          reportedAppVersion: null,
          requiredAppVersion,
          lastReportedAt: null
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
            SET assigned_location_id = $3,
                is_active = $4,
                deactivated_at = CASE WHEN $4 THEN NULL ELSE clock_timestamp() END,
                required_app_version = $5
          WHERE tenant_id = $1 AND device_id = $2
        RETURNING device_id, assigned_location_id, is_active, deactivated_at, required_app_version`,
        [tenantId, deviceId, assignedLocationId, isActive, requiredAppVersion]
      );
      const row = updated.rows[0]!;

      if (changedLocation) {
        await client.query(
          `INSERT INTO device_assignment_history
            (tenant_id, device_id, previous_location_id, assigned_location_id, reason, actor_type)
           VALUES ($1, $2, $3, $4, $5, 'system')`,
          [tenantId, deviceId, current.rows[0].assigned_location_id, assignedLocationId, update.assignmentReason!.trim()]
        );
      }

      await client.query(
        `INSERT INTO audit_log
          (tenant_id, actor_type, action, target_type, target_id, details)
         VALUES ($1, 'system', $2, 'device', $3, $4::jsonb)`,
        [
          tenantId,
          changedLocation && changedAvailability
            ? "device.reassigned_and_availability_changed"
            : changedLocation
              ? "device.reassigned"
              : isActive
                ? "device.enabled"
                : changedRequiredVersion
                  ? "device.required_version_changed"
                  : "device.disabled",
          deviceId,
          JSON.stringify({
            before: current.rows[0],
            after: { assignedLocationId, isActive, requiredAppVersion },
            ...(changedLocation ? { assignmentReason: update.assignmentReason!.trim() } : {}),
            source: "pilot_admin_console"
          })
        ]
      );

      return {
        deviceId: row.device_id,
        assignedLocationId: row.assigned_location_id,
        isActive: row.is_active,
        deactivatedAt: row.deactivated_at?.toISOString() ?? null,
        pendingOfflineScanCount: 0,
        reportedAppVersion: null,
        requiredAppVersion: row.required_app_version,
        lastReportedAt: null
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
}
