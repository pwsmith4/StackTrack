import type { Pool, PoolClient } from "pg";

export type ManagedLocationType = "donation_express" | "store_backroom" | "warehouse";

export interface LocationAdministrationActor {
  readonly userId: string;
}

export interface NewLocation {
  readonly name: string;
  readonly type: ManagedLocationType;
}

export interface LocationRecord {
  readonly locationId: string;
  readonly name: string;
  readonly type: ManagedLocationType | "in_transit";
  readonly isActive: boolean;
}

export interface LocationDependencyDevice {
  readonly deviceId: string;
  readonly label: string;
  readonly isActive: boolean;
}

export interface LocationDependencyManager {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
}

export interface LocationDependencySummary {
  readonly location: LocationRecord;
  readonly devices: readonly LocationDependencyDevice[];
  /** Location Managers who would lose their scope if this site is retired. */
  readonly managers: readonly LocationDependencyManager[];
  /** Containers whose latest recorded observation points at this location. */
  readonly currentContainerCount: number;
  /** Historical load codes created at the location; these are never rewritten. */
  readonly loadCodeCount: number;
  /** Immutable observations that reference the location. */
  readonly observationCount: number;
}

export interface RetireLocationInput {
  readonly replacementLocationId?: string;
  readonly moveDevicesToUnknown?: boolean;
  readonly confirmation?: string;
}

export interface LocationRetireResult {
  readonly location: LocationRecord;
  readonly movedDeviceCount: number;
  readonly replacementLocationId: string | null;
  readonly unknownLocationId: string | null;
  readonly dependencies: LocationDependencySummary;
}

export interface LocationAdministration {
  dependencies(tenantId: string, locationId: string): Promise<LocationDependencySummary | null>;
  create(
    tenantId: string,
    actor: LocationAdministrationActor,
    input: NewLocation
  ): Promise<LocationRecord>;
  retire(
    tenantId: string,
    actor: LocationAdministrationActor,
    locationId: string,
    input: RetireLocationInput
  ): Promise<LocationRetireResult>;
}

export class LocationRetireConflict extends Error {
  public constructor(
    message: string,
    readonly dependencies: LocationDependencySummary
  ) {
    super(message);
    this.name = "LocationRetireConflict";
  }
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isReservedLocationName(name: string): boolean {
  return ["unknown location", "in transit"].includes(name.trim().toLowerCase());
}

function locationRecord(row: {
  location_id: string;
  location_name: string;
  location_type: LocationRecord["type"];
  is_active: boolean;
}): LocationRecord {
  return {
    locationId: row.location_id,
    name: row.location_name,
    type: row.location_type,
    isActive: row.is_active
  };
}

export class PostgresLocationAdministration implements LocationAdministration {
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

  private async dependencySummary(
    client: PoolClient,
    tenantId: string,
    locationId: string
  ): Promise<LocationDependencySummary | null> {
    const locationResult = await client.query<{
      location_id: string;
      location_name: string;
      location_type: LocationRecord["type"];
      is_active: boolean;
    }>(
      `SELECT location_id, location_name, location_type, is_active
         FROM locations
        WHERE tenant_id = $1 AND location_id = $2`,
      [tenantId, locationId]
    );
    const location = locationResult.rows[0];
    if (!location) return null;

    const [devices, managers, containers, loadCodes, observations] = await Promise.all([
      client.query<{
        device_id: string;
        device_label: string;
        is_active: boolean;
      }>(
        `SELECT device_id, device_label, is_active
           FROM devices
          WHERE tenant_id = $1 AND assigned_location_id = $2
          ORDER BY device_label`,
        [tenantId, locationId]
      ),
      client.query<{
        user_id: string;
        username: string;
        display_name: string;
      }>(
        `SELECT u.user_id, u.username, u.display_name
           FROM admin_user_locations scope
           JOIN admin_users u
             ON u.tenant_id = scope.tenant_id AND u.user_id = scope.user_id
          WHERE scope.tenant_id = $1 AND scope.location_id = $2
          ORDER BY u.display_name, u.username`,
        [tenantId, locationId]
      ),
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM (
             SELECT DISTINCT ON (container_id) container_id, location_id
               FROM asset_events
              WHERE tenant_id = $1
              ORDER BY container_id, effective_at DESC, received_at DESC, event_id DESC
           ) latest
          WHERE latest.location_id = $2`,
        [tenantId, locationId]
      ),
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM load_codes
          WHERE tenant_id = $1 AND generating_location_id = $2`,
        [tenantId, locationId]
      ),
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM asset_events
          WHERE tenant_id = $1 AND location_id = $2`,
        [tenantId, locationId]
      )
    ]);

    return {
      location: locationRecord(location),
      devices: devices.rows.map((row) => ({
        deviceId: row.device_id,
        label: row.device_label,
        isActive: row.is_active
      })),
      managers: managers.rows.map((row) => ({
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name
      })),
      currentContainerCount: Number(containers.rows[0]?.count ?? 0),
      loadCodeCount: Number(loadCodes.rows[0]?.count ?? 0),
      observationCount: Number(observations.rows[0]?.count ?? 0)
    };
  }

  public async dependencies(
    tenantId: string,
    locationId: string
  ): Promise<LocationDependencySummary | null> {
    return this.tenantTransaction(tenantId, (client) =>
      this.dependencySummary(client, tenantId, locationId)
    );
  }

  public async create(
    tenantId: string,
    actor: LocationAdministrationActor,
    input: NewLocation
  ): Promise<LocationRecord> {
    return this.tenantTransaction(tenantId, async (client) => {
      const name = normalizeName(input.name);
      if (name.length < 2 || name.length > 120) {
        throw new Error("Location name must contain 2-120 characters.");
      }
      if (isReservedLocationName(name)) {
        throw new Error("Unknown location and In transit are system locations and cannot be created here.");
      }

      const result = await client.query<{
        location_id: string;
        location_name: string;
        location_type: LocationRecord["type"];
        is_active: boolean;
      }>(
        `INSERT INTO locations (tenant_id, location_name, location_type)
         VALUES ($1, $2, $3)
         RETURNING location_id, location_name, location_type, is_active`,
        [tenantId, name, input.type]
      );
      const row = result.rows[0]!;
      await client.query(
        `INSERT INTO audit_log
          (tenant_id, actor_type, actor_id, action, target_type, target_id, details)
         VALUES ($1, 'user', $2, 'location.created', 'location', $3, $4::jsonb)`,
        [
          tenantId,
          actor.userId,
          row.location_id,
          JSON.stringify({
            locationName: row.location_name,
            locationType: row.location_type,
            source: "pilot_admin_console"
          })
        ]
      );
      return locationRecord(row);
    });
  }

  public async retire(
    tenantId: string,
    actor: LocationAdministrationActor,
    locationId: string,
    input: RetireLocationInput
  ): Promise<LocationRetireResult> {
    return this.tenantTransaction(tenantId, async (client) => {
      const locked = await client.query<{
        location_id: string;
        location_name: string;
        location_type: LocationRecord["type"];
        is_active: boolean;
      }>(
        `SELECT location_id, location_name, location_type, is_active
           FROM locations
          WHERE tenant_id = $1 AND location_id = $2
          FOR UPDATE`,
        [tenantId, locationId]
      );
      const row = locked.rows[0];
      if (!row) throw new Error("Location was not found.");
      if (!row.is_active) throw new Error("This location has already been retired.");
      if (row.location_type === "in_transit" || isReservedLocationName(row.location_name)) {
        throw new Error("System locations cannot be retired.");
      }
      if (normalizeName(input.confirmation ?? "") !== row.location_name) {
        throw new Error(`Type the exact location name, “${row.location_name}”, to confirm retirement.`);
      }
      if (input.replacementLocationId === locationId) {
        throw new Error("A location cannot replace itself.");
      }
      if (input.replacementLocationId && input.moveDevicesToUnknown) {
        throw new Error("Choose one scanner destination: a replacement location or Unknown location.");
      }

      const dependencies = await this.dependencySummary(client, tenantId, locationId);
      if (!dependencies) throw new Error("Location dependencies could not be loaded.");
      const hasDevices = dependencies.devices.length > 0;
      const hasManagers = dependencies.managers.length > 0;
      if (hasManagers) {
        throw new LocationRetireConflict(
          "Reassign or remove every Location Manager scope before retiring this location. This prevents a user from silently losing or retaining access to a closed site.",
          dependencies
        );
      }
      if (hasDevices && !input.replacementLocationId && !input.moveDevicesToUnknown) {
        throw new LocationRetireConflict(
          "Move the assigned scanners first, or explicitly move the remaining scanners to Unknown location before retiring this location.",
          dependencies
        );
      }

      let destinationId: string | null = input.replacementLocationId ?? null;
      let unknownLocationId: string | null = null;
      if (destinationId) {
        const destination = await client.query<{
          location_id: string;
          location_name: string;
          location_type: LocationRecord["type"];
          is_active: boolean;
        }>(
          `SELECT location_id, location_name, location_type, is_active
             FROM locations
            WHERE tenant_id = $1 AND location_id = $2`,
          [tenantId, destinationId]
        );
        const target = destination.rows[0];
        if (!target || !target.is_active || target.location_type === "in_transit" || isReservedLocationName(target.location_name)) {
          throw new Error("Replacement location is not an active operating location.");
        }
      } else if (input.moveDevicesToUnknown) {
        const unknown = await client.query<{
          location_id: string;
        }>(
          `INSERT INTO locations (tenant_id, location_name, location_type, is_active)
           VALUES ($1, 'Unknown location', 'store_backroom', TRUE)
           ON CONFLICT (tenant_id, location_name)
           DO UPDATE SET is_active = TRUE
           RETURNING location_id`,
          [tenantId]
        );
        unknownLocationId = unknown.rows[0]!.location_id;
        destinationId = unknownLocationId;
      }

      let movedDeviceCount = 0;
      if (destinationId && hasDevices) {
        for (const device of dependencies.devices) {
          await client.query(
            `UPDATE devices
                SET assigned_location_id = $3
              WHERE tenant_id = $1 AND device_id = $2`,
            [tenantId, device.deviceId, destinationId]
          );
          await client.query(
            `INSERT INTO device_assignment_history
              (tenant_id, device_id, previous_location_id, assigned_location_id, reason, actor_type, actor_id)
             VALUES ($1, $2, $3, $4, $5, 'user', $6)`,
            [
              tenantId,
              device.deviceId,
              locationId,
              destinationId,
              `Location retired: ${row.location_name}`,
              actor.userId
            ]
          );
          await client.query(
            `INSERT INTO audit_log
              (tenant_id, actor_type, actor_id, action, target_type, target_id, details)
             VALUES ($1, 'user', $2, 'device.reassigned', 'device', $3, $4::jsonb)`,
            [
              tenantId,
              actor.userId,
              device.deviceId,
              JSON.stringify({
                previousLocationId: locationId,
                assignedLocationId: destinationId,
                assignmentReason: `Location retired: ${row.location_name}`,
                source: "location_retirement"
              })
            ]
          );
          movedDeviceCount += 1;
        }
      }

      const retired = await client.query<{
        location_id: string;
        location_name: string;
        location_type: LocationRecord["type"];
        is_active: boolean;
      }>(
        `UPDATE locations
            SET is_active = FALSE
          WHERE tenant_id = $1 AND location_id = $2
        RETURNING location_id, location_name, location_type, is_active`,
        [tenantId, locationId]
      );
      const retiredLocation = retired.rows[0]!;
      await client.query(
        `INSERT INTO audit_log
          (tenant_id, actor_type, actor_id, action, target_type, target_id, details)
         VALUES ($1, 'user', $2, 'location.retired', 'location', $3, $4::jsonb)`,
        [
          tenantId,
          actor.userId,
          locationId,
          JSON.stringify({
            locationName: row.location_name,
            locationType: row.location_type,
            movedDeviceCount,
            replacementLocationId: input.replacementLocationId ?? null,
            unknownLocationId,
            currentContainerCount: dependencies.currentContainerCount,
            loadCodeCount: dependencies.loadCodeCount,
            observationCount: dependencies.observationCount,
            historyPreserved: true,
            source: "pilot_admin_console"
          })
        ]
      );

      return {
        location: locationRecord(retiredLocation),
        movedDeviceCount,
        replacementLocationId: input.replacementLocationId ?? null,
        unknownLocationId,
        dependencies
      };
    });
  }
}
