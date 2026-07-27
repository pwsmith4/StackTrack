import type { Pool, PoolClient } from "pg";

export interface DeviceControlUpdate {
  readonly assignedLocationId?: string;
  readonly isActive?: boolean;
}

export interface DeviceControlResult {
  readonly deviceId: string;
  readonly assignedLocationId: string;
  readonly isActive: boolean;
  readonly deactivatedAt: string | null;
}

export interface DeviceAdministration {
  update(
    tenantId: string,
    deviceId: string,
    update: DeviceControlUpdate
  ): Promise<DeviceControlResult | null>;
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
      }>(
        `SELECT assigned_location_id, is_active
           FROM devices
          WHERE tenant_id = $1 AND device_id = $2
          FOR UPDATE`,
        [tenantId, deviceId]
      );
      if (!current.rows[0]) return null;

      const assignedLocationId = update.assignedLocationId ?? current.rows[0].assigned_location_id;
      const isActive = update.isActive ?? current.rows[0].is_active;
      const changedLocation = assignedLocationId !== current.rows[0].assigned_location_id;
      const changedAvailability = isActive !== current.rows[0].is_active;

      if (!changedLocation && !changedAvailability) {
        return {
          deviceId,
          assignedLocationId,
          isActive,
          deactivatedAt: null
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
      }>(
        `UPDATE devices
            SET assigned_location_id = $3,
                is_active = $4,
                deactivated_at = CASE WHEN $4 THEN NULL ELSE clock_timestamp() END
          WHERE tenant_id = $1 AND device_id = $2
        RETURNING device_id, assigned_location_id, is_active, deactivated_at`,
        [tenantId, deviceId, assignedLocationId, isActive]
      );
      const row = updated.rows[0]!;

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
                : "device.disabled",
          deviceId,
          JSON.stringify({
            before: current.rows[0],
            after: { assignedLocationId, isActive },
            source: "pilot_admin_console"
          })
        ]
      );

      return {
        deviceId: row.device_id,
        assignedLocationId: row.assigned_location_id,
        isActive: row.is_active,
        deactivatedAt: row.deactivated_at?.toISOString() ?? null
      };
    });
  }
}
