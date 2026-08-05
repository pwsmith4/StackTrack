import type { Pool, PoolClient } from "pg";

export type ManagedLocationType = "donation_express" | "store_backroom" | "warehouse";

export type LocationTypeCategory = ManagedLocationType | "other" | "in_transit";
export const locationIconKeys = [
  "store",
  "warehouse",
  "hand-heart",
  "building-2",
  "map-pin",
  "boxes",
  "truck",
  "package-check"
] as const;
export type LocationIconKey = (typeof locationIconKeys)[number];

export interface LocationAdministrationActor {
  readonly userId: string;
}

export interface NewLocation {
  readonly name: string;
  /** Catalog key, not the operational category. */
  readonly type: string;
}

export interface NewLocationType {
  readonly name: string;
  readonly category: Exclude<LocationTypeCategory, "in_transit">;
  readonly iconKey: LocationIconKey;
}

export interface UpdateLocationType {
  readonly name: string;
  readonly iconKey: LocationIconKey;
}

export interface LocationTypeRecord {
  readonly typeKey: string;
  readonly name: string;
  readonly category: LocationTypeCategory;
  readonly iconKey: LocationIconKey;
  readonly isSystem: boolean;
  readonly isActive: boolean;
}

export interface LocationRecord {
  readonly locationId: string;
  readonly name: string;
  readonly type: LocationTypeCategory;
  readonly typeKey?: string;
  readonly typeName?: string;
  readonly iconKey?: LocationIconKey;
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
  readonly role: "location_manager" | "read_only_reviewer";
}

export interface LocationDependencySummary {
  readonly location: LocationRecord;
  readonly devices: readonly LocationDependencyDevice[];
  /** Scoped administrators who would lose their site boundary if this site is retired. */
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

export interface UpdateLocation {
  readonly name: string;
  readonly type: string;
}

export interface LocationAdministration {
  dependencies(tenantId: string, locationId: string): Promise<LocationDependencySummary | null>;
  create(
    tenantId: string,
    actor: LocationAdministrationActor,
    input: NewLocation
  ): Promise<LocationRecord>;
  update?(
    tenantId: string,
    actor: LocationAdministrationActor,
    locationId: string,
    input: UpdateLocation
  ): Promise<LocationRecord>;
  createType?(
    tenantId: string,
    actor: LocationAdministrationActor,
    input: NewLocationType
  ): Promise<LocationTypeRecord>;
  updateType?(
    tenantId: string,
    actor: LocationAdministrationActor,
    typeKey: string,
    input: UpdateLocationType
  ): Promise<LocationTypeRecord>;
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

function normalizeTypeName(value: string): string {
  return normalizeName(value);
}

function slugifyTypeName(value: string): string {
  return normalizeTypeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function assertIconKey(value: string): asserts value is LocationIconKey {
  if (!locationIconKeys.includes(value as LocationIconKey)) {
    throw new Error("Choose one of the available location icons.");
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "23505");
}

function locationRecord(row: {
  location_id: string;
  location_name: string;
  location_type: LocationRecord["type"];
  location_type_key?: string;
  display_name?: string;
  icon_key?: LocationIconKey;
  is_active: boolean;
}): LocationRecord {
  return {
    locationId: row.location_id,
    name: row.location_name,
    type: row.location_type,
    ...(row.location_type_key ? { typeKey: row.location_type_key } : {}),
    ...(row.display_name ? { typeName: row.display_name } : {}),
    ...(row.icon_key ? { iconKey: row.icon_key } : {}),
    isActive: row.is_active
  };
}

function locationTypeRecord(row: {
  type_key: string;
  display_name: string;
  category: LocationTypeCategory;
  icon_key: LocationIconKey;
  is_system: boolean;
  is_active: boolean;
}): LocationTypeRecord {
  return {
    typeKey: row.type_key,
    name: row.display_name,
    category: row.category,
    iconKey: row.icon_key,
    isSystem: row.is_system,
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
      location_type_key: string;
      display_name: string;
      icon_key: LocationIconKey;
      is_active: boolean;
    }>(
      `SELECT l.location_id, l.location_name, l.location_type,
              l.location_type_key, lt.display_name, lt.icon_key, l.is_active
         FROM locations l
         JOIN location_types lt
           ON lt.tenant_id = l.tenant_id AND lt.type_key = l.location_type_key
        WHERE l.tenant_id = $1 AND l.location_id = $2`,
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
        role: "location_manager" | "read_only_reviewer";
      }>(
        `SELECT u.user_id, u.username, u.display_name, u.role
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
        displayName: row.display_name,
        role: row.role
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

      const typeResult = await client.query<{
        type_key: string;
        category: LocationRecord["type"];
      }>(
        `SELECT type_key, category
           FROM location_types
          WHERE tenant_id = $1 AND type_key = $2 AND is_active`,
        [tenantId, input.type]
      );
      const type = typeResult.rows[0];
      if (!type || type.category === "in_transit") {
        throw new Error("Choose an active, non-system location type.");
      }

      const duplicate = await client.query<{ location_name: string }>(
        `SELECT location_name
           FROM locations
          WHERE tenant_id = $1 AND lower(location_name) = lower($2)
          LIMIT 1`,
        [tenantId, name]
      );
      if (duplicate.rows[0]) {
        throw new Error(`A location named “${duplicate.rows[0].location_name}” already exists. Choose a different name.`);
      }

      let result;
      try {
        result = await client.query<{
          location_id: string;
          location_name: string;
          location_type: LocationRecord["type"];
          location_type_key: string;
          display_name: string;
          icon_key: LocationIconKey;
          is_active: boolean;
        }>(
          `INSERT INTO locations (tenant_id, location_name, location_type, location_type_key)
           VALUES ($1, $2, $3, $4)
           RETURNING location_id, location_name, location_type, location_type_key, is_active`,
          [tenantId, name, type.category, input.type]
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("That location name was just used by another administrator. Choose a different name.");
        throw error;
      }
      const row = result.rows[0]!;
      const catalog = await client.query<{ display_name: string; icon_key: LocationIconKey }>(
        `SELECT display_name, icon_key FROM location_types WHERE tenant_id = $1 AND type_key = $2`,
        [tenantId, row.location_type_key]
      );
      Object.assign(row, catalog.rows[0]);
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
            locationTypeKey: row.location_type_key,
            source: "pilot_admin_console"
          })
        ]
      );
      return locationRecord(row);
    });
  }

  public async update(
    tenantId: string,
    actor: LocationAdministrationActor,
    locationId: string,
    input: UpdateLocation
  ): Promise<LocationRecord> {
    return this.tenantTransaction(tenantId, async (client) => {
      const name = normalizeName(input.name);
      if (name.length < 2 || name.length > 120) {
        throw new Error("Location name must contain 2-120 characters.");
      }
      if (isReservedLocationName(name)) {
        throw new Error("Unknown location and In transit are system locations and cannot be renamed.");
      }

      const locked = await client.query<{
        location_id: string;
        location_name: string;
        location_type: LocationRecord["type"];
        location_type_key: string;
        is_active: boolean;
      }>(
        `SELECT location_id, location_name, location_type, location_type_key, is_active
           FROM locations
          WHERE tenant_id = $1 AND location_id = $2
          FOR UPDATE`,
        [tenantId, locationId]
      );
      const current = locked.rows[0];
      if (!current) throw new Error("Location was not found.");
      if (!current.is_active || current.location_type === "in_transit") {
        throw new Error("Only active operating locations can be edited.");
      }
      if (isReservedLocationName(current.location_name)) {
        throw new Error("System locations cannot be edited.");
      }

      const typeResult = await client.query<{
        type_key: string;
        category: LocationRecord["type"];
      }>(
        `SELECT type_key, category
           FROM location_types
          WHERE tenant_id = $1 AND type_key = $2 AND is_active`,
        [tenantId, input.type]
      );
      const type = typeResult.rows[0];
      if (!type || type.category === "in_transit") {
        throw new Error("Choose an active, non-system location type.");
      }

      const duplicate = await client.query<{ location_name: string }>(
        `SELECT location_name
           FROM locations
          WHERE tenant_id = $1 AND lower(location_name) = lower($2) AND location_id <> $3
          LIMIT 1`,
        [tenantId, name, locationId]
      );
      if (duplicate.rows[0]) {
        throw new Error(`A location named “${duplicate.rows[0].location_name}” already exists. Choose a different name.`);
      }

      let updated;
      try {
        updated = await client.query<{
          location_id: string;
          location_name: string;
          location_type: LocationRecord["type"];
          location_type_key: string;
          is_active: boolean;
        }>(
          `UPDATE locations
              SET location_name = $3,
                  location_type = $4,
                  location_type_key = $5
            WHERE tenant_id = $1 AND location_id = $2
          RETURNING location_id, location_name, location_type, location_type_key, is_active`,
          [tenantId, locationId, name, type.category, input.type]
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("That location name was just used by another administrator. Choose a different name.");
        throw error;
      }
      const row = updated.rows[0]!;
      const catalog = await client.query<{ display_name: string; icon_key: LocationIconKey }>(
        `SELECT display_name, icon_key FROM location_types WHERE tenant_id = $1 AND type_key = $2`,
        [tenantId, row.location_type_key]
      );
      Object.assign(row, catalog.rows[0]);
      await client.query(
        `INSERT INTO audit_log
          (tenant_id, actor_type, actor_id, action, target_type, target_id, details)
         VALUES ($1, 'user', $2, 'location.updated', 'location', $3, $4::jsonb)`,
        [
          tenantId,
          actor.userId,
          locationId,
          JSON.stringify({
            before: { name: current.location_name, typeKey: current.location_type_key },
            after: { name: row.location_name, typeKey: row.location_type_key },
            historyPreserved: true,
            source: "pilot_admin_console"
          })
        ]
      );
      return locationRecord(row);
    });
  }

  public async createType(
    tenantId: string,
    actor: LocationAdministrationActor,
    input: NewLocationType
  ): Promise<LocationTypeRecord> {
    return this.tenantTransaction(tenantId, async (client) => {
      const name = normalizeTypeName(input.name);
      if (name.length < 2 || name.length > 80) {
        throw new Error("Location type name must contain 2-80 characters.");
      }
      assertIconKey(input.iconKey);
      const typeKey = slugifyTypeName(name);
      if (!typeKey) throw new Error("Location type name must contain letters or numbers.");

      const duplicate = await client.query<{ type_key: string; display_name: string }>(
        `SELECT type_key, display_name
           FROM location_types
          WHERE tenant_id = $1 AND (type_key = $2 OR lower(display_name) = lower($3))
          LIMIT 1`,
        [tenantId, typeKey, name]
      );
      if (duplicate.rows[0]) {
        throw new Error(`A location type named “${duplicate.rows[0].display_name}” already exists. Choose a different name.`);
      }

      let result;
      try {
        result = await client.query<{
          type_key: string;
          display_name: string;
          category: LocationTypeCategory;
          icon_key: LocationIconKey;
          is_system: boolean;
          is_active: boolean;
        }>(
          `INSERT INTO location_types
            (tenant_id, type_key, display_name, category, icon_key, is_system)
           VALUES ($1, $2, $3, $4, $5, FALSE)
           RETURNING type_key, display_name, category, icon_key, is_system, is_active`,
          [tenantId, typeKey, name, input.category, input.iconKey]
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("That location type was just added by another administrator. Choose a different name.");
        throw error;
      }
      const row = result.rows[0]!;
      await client.query(
        `INSERT INTO audit_log
          (tenant_id, actor_type, actor_id, action, target_type, target_id, details)
         VALUES ($1, 'user', $2, 'location_type.created', 'location_type', NULL, $3::jsonb)`,
        [tenantId, actor.userId, JSON.stringify({ typeKey, name, category: input.category, iconKey: input.iconKey, source: "pilot_admin_console" })]
      );
      return locationTypeRecord(row);
    });
  }

  public async updateType(
    tenantId: string,
    actor: LocationAdministrationActor,
    typeKey: string,
    input: UpdateLocationType
  ): Promise<LocationTypeRecord> {
    return this.tenantTransaction(tenantId, async (client) => {
      const name = normalizeTypeName(input.name);
      if (name.length < 2 || name.length > 80) {
        throw new Error("Location type name must contain 2-80 characters.");
      }
      assertIconKey(input.iconKey);
      const current = await client.query<{
        type_key: string;
        display_name: string;
        category: LocationTypeCategory;
        icon_key: LocationIconKey;
        is_system: boolean;
        is_active: boolean;
      }>(
        `SELECT type_key, display_name, category, icon_key, is_system, is_active
           FROM location_types
          WHERE tenant_id = $1 AND type_key = $2
          FOR UPDATE`,
        [tenantId, typeKey]
      );
      const before = current.rows[0];
      if (!before || !before.is_active) throw new Error("Location type was not found.");
      const duplicate = await client.query<{ display_name: string }>(
        `SELECT display_name
           FROM location_types
          WHERE tenant_id = $1 AND lower(display_name) = lower($2) AND type_key <> $3
          LIMIT 1`,
        [tenantId, name, typeKey]
      );
      if (duplicate.rows[0]) {
        throw new Error(`A location type named “${duplicate.rows[0].display_name}” already exists. Choose a different name.`);
      }

      let updated;
      try {
        updated = await client.query<{
          type_key: string;
          display_name: string;
          category: LocationTypeCategory;
          icon_key: LocationIconKey;
          is_system: boolean;
          is_active: boolean;
        }>(
          `UPDATE location_types
              SET display_name = $3, icon_key = $4, updated_at = clock_timestamp()
            WHERE tenant_id = $1 AND type_key = $2
          RETURNING type_key, display_name, category, icon_key, is_system, is_active`,
          [tenantId, typeKey, name, input.iconKey]
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("That location type was just renamed by another administrator. Choose a different name.");
        throw error;
      }
      const row = updated.rows[0]!;
      await client.query(
        `INSERT INTO audit_log
          (tenant_id, actor_type, actor_id, action, target_type, target_id, details)
         VALUES ($1, 'user', $2, 'location_type.updated', 'location_type', NULL, $3::jsonb)`,
        [
          tenantId,
          actor.userId,
          JSON.stringify({
            typeKey,
            before: { name: before.display_name, iconKey: before.icon_key },
            after: { name: row.display_name, iconKey: row.icon_key },
            source: "pilot_admin_console"
          })
        ]
      );
      return locationTypeRecord(row);
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
          "Reassign or remove every scoped administrator assignment before retiring this location. This prevents a user from silently losing or retaining access to a closed site.",
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
          `INSERT INTO locations (tenant_id, location_name, location_type, location_type_key, is_active)
           VALUES ($1, 'Unknown location', 'store_backroom', 'store_backroom', TRUE)
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
