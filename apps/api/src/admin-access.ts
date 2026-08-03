import { createHash, createHmac, pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Pool, PoolClient } from "pg";

const pbkdf2 = promisify(pbkdf2Callback);
const passwordIterations = 210_000;
const sessionLifetimeMs = 1000 * 60 * 60 * 12;

export type AdminRole = "organization_owner" | "operations_administrator" | "location_manager" | "read_only_reviewer" | "support";
export type ManagedAdminRole = Exclude<AdminRole, "support">;

export interface AdminPrincipal {
  readonly tenantId: string;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: AdminRole;
  /** Assigned operating locations for Location Managers and optionally scoped read-only reviewers. */
  readonly locationIds?: readonly string[];
  readonly supportExpiresAt: string | null;
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
  /** Present only while a higher-level administrator is safely previewing a lower role. */
  readonly rolePreview?: AdminRolePreview;
}

export interface AdminSession {
  readonly token: string;
  readonly principal: AdminPrincipal;
  readonly expiresAt: string;
}

export interface NewAdminUser {
  readonly username: string;
  readonly displayName: string;
  readonly role: ManagedAdminRole;
  readonly temporaryPassword: string;
  readonly locationIds?: readonly string[];
}

export interface AdminUserUpdate {
  readonly displayName?: string;
  readonly role?: ManagedAdminRole;
  readonly isActive?: boolean;
  readonly locationIds?: readonly string[];
}

export interface AdminRolePreview {
  readonly sourceRole: AdminRole;
  readonly previewRole: AdminRole;
  readonly locationIds: readonly string[];
  readonly expiresAt: string;
}

export interface AdminRolePreviewSession {
  readonly previewToken: string;
  readonly principal: AdminPrincipal;
  readonly expiresAt: string;
  readonly preview: AdminRolePreview;
}

const rolePreviewLifetimeMs = 1000 * 60 * 30;
const rolePreviewRoles: readonly AdminRole[] = [
  "organization_owner",
  "operations_administrator",
  "location_manager",
  "read_only_reviewer"
];

function rolePreviewRank(role: AdminRole): number {
  return {
    organization_owner: 4,
    operations_administrator: 3,
    location_manager: 2,
    read_only_reviewer: 1,
    support: 0
  }[role];
}

function previewTokenPart(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function createPreviewSignature(payload: string, sessionToken: string): string {
  return createHmac("sha256", sessionToken).update(`${payload}.${sessionToken.length}`).digest("base64url");
}

function createPreviewToken(payload: Record<string, unknown>, sessionToken: string): string {
  const encoded = previewTokenPart(JSON.stringify(payload));
  return `${encoded}.${createPreviewSignature(encoded, sessionToken)}`;
}

function readPreviewToken(token: string, sessionToken: string): Record<string, unknown> | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = createPreviewSignature(encoded, sessionToken);
  const actualBytes = Buffer.from(signature, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export interface AdminUserRemoval {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: AdminRole;
}

export interface AuditEntry {
  readonly auditId: string;
  readonly occurredAt: string;
  readonly actorType: "user" | "device" | "system";
  readonly actorDisplayName: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly details: Record<string, unknown>;
  readonly actorUsername: string | null;
  readonly targetLabel: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
}

export interface AuditFilters {
  readonly search?: string;
  readonly locationId?: string;
  readonly deviceId?: string;
  /** User-selected location/device filters. Scoped locationIds remains an internal access constraint. */
  readonly selectedLocationIds?: readonly string[];
  readonly selectedDeviceIds?: readonly string[];
  readonly actorUserId?: string;
  readonly actionPrefixes?: readonly string[];
  readonly targetTypes?: readonly string[];
  readonly actionPrefix?: string;
  readonly targetType?: string;
  /** Internal scope constraint used for Location Manager audit views. */
  readonly locationIds?: readonly string[];
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AuditPage {
  readonly items: AuditEntry[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

type AdminRow = Record<string, unknown>;

function rowPrincipal(row: AdminRow): AdminPrincipal {
  const rawLocationIds = row.location_ids;
  const locationIds = Array.isArray(rawLocationIds)
    ? rawLocationIds.map(String)
    : typeof rawLocationIds === "string" && rawLocationIds.length > 0
      ? rawLocationIds.replace(/[{}]/g, "").split(",").filter(Boolean)
      : [];
  const principal: AdminPrincipal = {
    tenantId: String(row.tenant_id), userId: String(row.user_id), username: String(row.username),
    displayName: String(row.display_name), role: row.role as AdminRole,
    supportExpiresAt: row.support_expires_at ? new Date(String(row.support_expires_at)).toISOString() : null,
    isActive: row.is_active === undefined ? true : Boolean(row.is_active),
    mustChangePassword: Boolean(row.must_change_password)
  };
  return locationIds.length > 0 ? { ...principal, locationIds } : principal;
}

function validatePassword(password: string, label = "Password"): void {
  if (password.length < 12) throw new Error(`${label} must be at least 12 characters.`);
  if (password.length > 256) throw new Error(`${label} is too long.`);
}

function validateDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (normalized.length < 2 || normalized.length > 120) {
    throw new Error("Display name must contain 2-120 characters.");
  }
  return normalized;
}

function validateUsername(usernameInput: string): string {
  const username = usernameInput.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new Error("Username must use 3-64 lowercase letters, numbers, periods, underscores, or hyphens.");
  }
  return username;
}

function validateManagedRole(role: unknown): asserts role is ManagedAdminRole {
  if (!(["organization_owner", "operations_administrator", "location_manager", "read_only_reviewer"] as const).includes(role as ManagedAdminRole)) {
    throw new Error("Choose a valid StackTrack administrator role.");
  }
}

function validateAdminActionReason(reasonInput: string): string {
  const reason = reasonInput.trim();
  if (reason.length < 8 || reason.length > 500) {
    throw new Error("A password reset needs a clear reason of 8-500 characters.");
  }
  return reason;
}

function validateAccessHelpMessage(messageInput: string): string {
  const message = messageInput.trim();
  if (message.length < 8 || message.length > 500) {
    throw new Error("Tell the administrator what is preventing sign-in (8-500 characters).");
  }
  return message;
}

function normalizeAccessHelpUsername(usernameInput: string | undefined): string | null {
  const username = usernameInput?.trim().toLowerCase() ?? "";
  if (!username) return null;
  return username.slice(0, 64);
}

function normalizeLocationIds(locationIds: readonly string[] | undefined): string[] {
  const values = [...new Set((locationIds ?? []).map((value) => String(value).trim()).filter(Boolean))];
  if (values.some((value) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))) {
    throw new Error("Location assignments must use valid StackTrack location IDs.");
  }
  return values;
}

export async function hashPassword(password: string, salt = randomBytes(16).toString("base64url")): Promise<string> {
  const derived = await pbkdf2(password, salt, passwordIterations, 32, "sha512");
  return `pbkdf2-sha512$${passwordIterations}$${salt}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationValue, salt, expected] = encoded.split("$");
  if (algorithm !== "pbkdf2-sha512" || !iterationValue || !salt || !expected) return false;
  const iterations = Number.parseInt(iterationValue, 10);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000) return false;
  const actual = await pbkdf2(password, salt, iterations, 32, "sha512");
  const expectedBytes = Buffer.from(expected, "base64url");
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

export class PostgresAdminAccess {
  public constructor(private readonly pool: Pool, private readonly tenantId: string) {}

  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [this.tenantId]);
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async audit(client: PoolClient, actor: AdminPrincipal, action: string, targetId: string, details: Record<string, unknown> = {}): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target_type, target_id, details)
       VALUES ($1,'user',$2,$3,'admin_user',$4,$5::jsonb)`,
      [this.tenantId, actor.userId, action, targetId, JSON.stringify(details)]
    );
  }

  public async signIn(usernameInput: string, password: string): Promise<AdminSession | null> {
    const username = usernameInput.trim().toLowerCase();
    return this.transaction(async (client) => {
      const user = await client.query(
        `SELECT admin_users.tenant_id, admin_users.user_id, admin_users.username, admin_users.display_name, admin_users.role, admin_users.support_expires_at, admin_users.is_active, admin_users.must_change_password, admin_users.password_hash,
                (SELECT COALESCE(array_agg(scope.location_id::text ORDER BY scope.location_id), ARRAY[]::text[])
                   FROM admin_user_locations scope
                  WHERE scope.tenant_id = admin_users.tenant_id AND scope.user_id = admin_users.user_id) AS location_ids
           FROM admin_users
          WHERE tenant_id = $1 AND username = $2 AND is_active
            AND (support_expires_at IS NULL OR support_expires_at > clock_timestamp())`,
        [this.tenantId, username]
      );
      const row = user.rows[0] as AdminRow | undefined;
      if (!row?.password_hash || !(await verifyPassword(password, String(row.password_hash)))) return null;
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
      await client.query(
        `INSERT INTO admin_sessions (tenant_id, user_id, token_sha256, expires_at) VALUES ($1,$2,$3,$4)`,
        [this.tenantId, row.user_id, tokenHash, expiresAt]
      );
      const principal = rowPrincipal(row);
      await this.audit(client, principal, "admin.signed_in", principal.userId, { username, source: "admin_console" });
      return { token, principal, expiresAt };
    });
  }

  public async authenticate(token: string): Promise<AdminPrincipal | null> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    return this.transaction(async (client) => {
      const found = await client.query(
        `SELECT u.tenant_id, u.user_id, u.username, u.display_name, u.role, u.support_expires_at, u.is_active, u.must_change_password,
                (SELECT COALESCE(array_agg(scope.location_id::text ORDER BY scope.location_id), ARRAY[]::text[])
                   FROM admin_user_locations scope
                  WHERE scope.tenant_id = u.tenant_id AND scope.user_id = u.user_id) AS location_ids
           FROM admin_sessions s JOIN admin_users u ON u.tenant_id=s.tenant_id AND u.user_id=s.user_id
          WHERE s.tenant_id=$1 AND s.token_sha256=$2 AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
            AND u.is_active AND (u.support_expires_at IS NULL OR u.support_expires_at > clock_timestamp())`,
        [this.tenantId, tokenHash]
      );
      if (!found.rows[0]) return null;
      await client.query(`UPDATE admin_sessions SET last_seen_at=clock_timestamp() WHERE tenant_id=$1 AND token_sha256=$2`, [this.tenantId, tokenHash]);
      return rowPrincipal(found.rows[0]);
    });
  }

  /**
   * Create a short-lived, read-only capability for inspecting a lower role.
   * The capability is signed with the already-authenticated session token, so
   * it is useless without that session and does not require a new database
   * table or a second password. The effective principal is still resolved by
   * the API on every request; the browser cannot grant itself access.
   */
  public async startRolePreview(
    actor: AdminPrincipal,
    sessionToken: string,
    previewRoleInput: string,
    requestedLocationIds: readonly string[] | undefined
  ): Promise<AdminRolePreviewSession> {
    if (!rolePreviewRoles.includes(previewRoleInput as AdminRole)) {
      throw new Error("Choose a valid lower administrator role to preview.");
    }
    const previewRole = previewRoleInput as AdminRole;
    if (rolePreviewRank(actor.role) <= rolePreviewRank(previewRole)) {
      throw new Error("You can only preview a lower permission level.");
    }
    if (actor.role === "support" || previewRole === "organization_owner" || previewRole === "support") {
      throw new Error("This administrator level cannot be previewed.");
    }
    let locationIds = normalizeLocationIds(requestedLocationIds);
    // A scoped Location Manager may preview a read-only screen only within the
    // same assigned sites. Never let a lower-role preview become an accidental
    // network-wide access expansion.
    if (actor.role === "location_manager") {
      const actorLocationIds = normalizeLocationIds(actor.locationIds);
      if (!actorLocationIds.length) throw new Error("This Location Manager has no assigned locations to preview.");
      if (locationIds.length === 0) locationIds = actorLocationIds;
      if (locationIds.some((locationId) => !actorLocationIds.includes(locationId))) {
        throw new Error("A role preview cannot include locations outside your assigned scope.");
      }
    }
    if (previewRole === "location_manager" && locationIds.length === 0) {
      throw new Error("Choose at least one location for a Location Manager preview.");
    }
    if (locationIds.length > 0) {
      await this.transaction(async (client) => {
        const locations = await client.query(
          `SELECT location_id
             FROM locations
            WHERE tenant_id=$1 AND is_active
              AND lower(location_name) NOT IN ('unknown location', 'in transit')
              AND location_id = ANY($2::uuid[])`,
          [this.tenantId, locationIds]
        );
        if (locations.rows.length !== locationIds.length) {
          throw new Error("Every preview location must be an active operating location.");
        }
        return undefined;
      });
    }
    const expiresAt = new Date(Date.now() + rolePreviewLifetimeMs).toISOString();
    const preview: AdminRolePreview = {
      sourceRole: actor.role,
      previewRole,
      locationIds,
      expiresAt
    };
    const payload = {
      version: 1,
      tenantId: this.tenantId,
      actorUserId: actor.userId,
      sourceRole: actor.role,
      previewRole,
      locationIds,
      expiresAt,
      nonce: randomBytes(12).toString("base64url")
    };
    const previewToken = createPreviewToken(payload, sessionToken);
    await this.transaction(async (client) => {
      await this.audit(client, actor, "admin.role_preview_started", actor.userId, {
        sourceRole: actor.role,
        previewRole,
        locationIds,
        expiresAt
      });
    });
    return {
      previewToken,
      expiresAt,
      preview,
      principal: {
        ...actor,
        role: previewRole,
        ...(locationIds.length > 0 ? { locationIds } : { locationIds: [] }),
        rolePreview: preview
      }
    };
  }

  /** Resolve and validate a role-preview capability against its real session. */
  public async resolveRolePreview(
    actor: AdminPrincipal,
    sessionToken: string,
    previewToken: string
  ): Promise<AdminPrincipal | null> {
    const payload = readPreviewToken(previewToken, sessionToken);
    if (!payload) return null;
    const expiresAt = typeof payload.expiresAt === "string" ? payload.expiresAt : "";
    const previewRole = typeof payload.previewRole === "string" ? payload.previewRole as AdminRole : null;
    const sourceRole = typeof payload.sourceRole === "string" ? payload.sourceRole as AdminRole : null;
    const actorUserId = typeof payload.actorUserId === "string" ? payload.actorUserId : null;
    const tenantId = typeof payload.tenantId === "string" ? payload.tenantId : null;
    const locationIds = Array.isArray(payload.locationIds) ? payload.locationIds.map(String) : [];
    if (!previewRole || !sourceRole || !rolePreviewRoles.includes(previewRole) || !rolePreviewRoles.includes(sourceRole)) return null;
    if (tenantId !== this.tenantId || actorUserId !== actor.userId || sourceRole !== actor.role) return null;
    if (rolePreviewRank(actor.role) <= rolePreviewRank(previewRole)) return null;
    if (!expiresAt || Date.parse(expiresAt) <= Date.now()) return null;
    try { normalizeLocationIds(locationIds); } catch { return null; }
    if (actor.role === "location_manager") {
      const actorLocationIds = actor.locationIds ?? [];
      if (!actorLocationIds.length || locationIds.some((locationId) => !actorLocationIds.includes(locationId))) return null;
    }
    if (previewRole === "location_manager" && locationIds.length === 0) return null;
    const preview: AdminRolePreview = { sourceRole, previewRole, locationIds, expiresAt };
    return {
      ...actor,
      role: previewRole,
      locationIds,
      rolePreview: preview
    };
  }

  public async revokeSession(actor: AdminPrincipal, token: string): Promise<void> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await this.transaction(async (client) => {
      await client.query(`UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND token_sha256=$2 AND user_id=$3 AND revoked_at IS NULL`, [this.tenantId, tokenHash, actor.userId]);
      await this.audit(client, actor, "admin.signed_out", actor.userId, { source: "admin_console" });
    });
  }

  public async changePassword(actor: AdminPrincipal, token: string, currentPassword: string, nextPassword: string): Promise<void> {
    validatePassword(nextPassword, "New password");
    if (currentPassword === nextPassword) throw new Error("Choose a password different from the current password.");
    const currentTokenHash = createHash("sha256").update(token).digest("hex");
    const passwordHash = await hashPassword(nextPassword);
    await this.transaction(async (client) => {
      const found = await client.query(`SELECT password_hash FROM admin_users WHERE tenant_id=$1 AND user_id=$2 AND is_active FOR UPDATE`, [this.tenantId, actor.userId]);
      const storedHash = found.rows[0]?.password_hash;
      if (!storedHash || !(await verifyPassword(currentPassword, String(storedHash)))) {
        throw new Error("Current password is not valid.");
      }
      await client.query(`UPDATE admin_users SET password_hash=$3, must_change_password=false, updated_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2`, [this.tenantId, actor.userId, passwordHash]);
      await client.query(`UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2 AND token_sha256 <> $3 AND revoked_at IS NULL`, [this.tenantId, actor.userId, currentTokenHash]);
      await this.audit(client, actor, "admin.password_changed", actor.userId, { revokedOtherSessions: true });
    });
  }

  public async listUsers(): Promise<AdminPrincipal[]> {
    return this.transaction(async (client) => {
      const result = await client.query(`SELECT u.tenant_id,u.user_id,u.username,u.display_name,u.role,u.support_expires_at,u.is_active,u.must_change_password,
                (SELECT COALESCE(array_agg(scope.location_id::text ORDER BY scope.location_id), ARRAY[]::text[])
                   FROM admin_user_locations scope
                  WHERE scope.tenant_id = u.tenant_id AND scope.user_id = u.user_id) AS location_ids
           FROM admin_users u WHERE u.tenant_id=$1 ORDER BY u.role, u.username`, [this.tenantId]);
      return result.rows.map(rowPrincipal);
    });
  }

  public async listAuditEntries(limit = 100): Promise<AuditEntry[]> {
    return (await this.searchAuditEntries({ limit })).items;
  }

  public async searchAuditEntries(filters: AuditFilters = {}): Promise<AuditPage> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(filters.limit ?? 100), 250));
    const safeOffset = Math.max(0, Math.trunc(filters.offset ?? 0));
    const values: unknown[] = [this.tenantId];
    const clauses = ["a.tenant_id=$1"];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      clauses.push(clause.replaceAll("$VALUE", `$${values.length}`));
    };
    if (filters.search?.trim()) add("concat_ws(' ', a.action, a.target_type, a.target_id, u.display_name, u.username, target_device.device_label, target_container.container_label, audit_location.location_name, a.details::text) ILIKE '%' || $VALUE || '%'", filters.search.trim().slice(0, 120));
    if (filters.locationId) add("EXISTS (SELECT 1 FROM locations filter_location WHERE filter_location.tenant_id=a.tenant_id AND filter_location.location_id=$VALUE::uuid AND (a.target_id=filter_location.location_id OR a.details->>'locationId'=filter_location.location_id::text OR a.details->>'assignedLocationId'=filter_location.location_id::text OR a.details->>'previousLocationId'=filter_location.location_id::text OR a.details->'after'->>'assignedLocationId'=filter_location.location_id::text OR a.details->'after'->>'assigned_location_id'=filter_location.location_id::text OR a.details->'before'->>'assignedLocationId'=filter_location.location_id::text OR a.details->'before'->>'assigned_location_id'=filter_location.location_id::text))", filters.locationId);
    if (filters.deviceId) add("(a.target_id=$VALUE::uuid OR a.details->>'deviceId'=$VALUE::text)", filters.deviceId);
    if (filters.selectedLocationIds?.length) add(`EXISTS (SELECT 1 FROM locations filter_location WHERE filter_location.tenant_id=a.tenant_id AND filter_location.location_id = ANY($VALUE::uuid[]) AND (a.target_id=filter_location.location_id OR a.details->>'locationId'=filter_location.location_id::text OR a.details->>'assignedLocationId'=filter_location.location_id::text OR a.details->>'previousLocationId'=filter_location.location_id::text OR a.details->'after'->>'assignedLocationId'=filter_location.location_id::text OR a.details->'after'->>'assigned_location_id'=filter_location.location_id::text OR a.details->'before'->>'assignedLocationId'=filter_location.location_id::text OR a.details->'before'->>'assigned_location_id'=filter_location.location_id::text))`, filters.selectedLocationIds.slice(0, 100));
    if (filters.selectedDeviceIds?.length) add("(a.target_id = ANY($VALUE::uuid[]) OR a.details->>'deviceId' = ANY($VALUE::text[]))", filters.selectedDeviceIds.slice(0, 100));
    if (filters.actorUserId) add("a.actor_id=$VALUE::uuid", filters.actorUserId);
    if (filters.actionPrefixes?.length) add("a.action LIKE ANY($VALUE::text[])", filters.actionPrefixes.slice(0, 12).map((prefix) => `${prefix.trim().slice(0, 64)}%`));
    else if (filters.actionPrefix) add("a.action LIKE $VALUE || '%'", filters.actionPrefix.trim().slice(0, 64));
    if (filters.targetTypes?.length) add("a.target_type = ANY($VALUE::text[])", filters.targetTypes.slice(0, 12).map((targetType) => targetType.trim().slice(0, 64)));
    else if (filters.targetType) add("a.target_type=$VALUE", filters.targetType.trim().slice(0, 64));
    if (filters.locationIds) {
      const locationIds = filters.locationIds.slice(0, 100);
      add(`(
        EXISTS (
          SELECT 1 FROM locations scoped_location
           WHERE scoped_location.tenant_id=a.tenant_id
             AND scoped_location.location_id = ANY($VALUE::uuid[])
             AND (
               a.target_id=scoped_location.location_id
               OR a.details->>'locationId'=scoped_location.location_id::text
               OR a.details->>'assignedLocationId'=scoped_location.location_id::text
               OR a.details->>'previousLocationId'=scoped_location.location_id::text
               OR a.details->'after'->>'assignedLocationId'=scoped_location.location_id::text
               OR a.details->'after'->>'assigned_location_id'=scoped_location.location_id::text
               OR a.details->'before'->>'assignedLocationId'=scoped_location.location_id::text
               OR a.details->'before'->>'assigned_location_id'=scoped_location.location_id::text
             )
        )
        OR (a.target_type='device' AND EXISTS (
          SELECT 1 FROM devices scoped_device
           WHERE scoped_device.tenant_id=a.tenant_id
             AND scoped_device.device_id=a.target_id
             AND scoped_device.assigned_location_id = ANY($VALUE::uuid[])
        ))
        OR (a.target_type IN ('container','review_case','correction_request') AND EXISTS (
          SELECT 1 FROM asset_events scoped_event
           WHERE scoped_event.tenant_id=a.tenant_id
             AND scoped_event.location_id = ANY($VALUE::uuid[])
             AND (
               (a.target_type='container' AND scoped_event.container_id=a.target_id)
               OR (a.target_type='review_case' AND EXISTS (SELECT 1 FROM review_cases scoped_review WHERE scoped_review.tenant_id=a.tenant_id AND scoped_review.review_case_id=a.target_id AND scoped_event.event_id = ANY(scoped_review.evidence_event_ids)))
               OR (a.target_type='correction_request' AND EXISTS (SELECT 1 FROM correction_requests scoped_correction WHERE scoped_correction.tenant_id=a.tenant_id AND scoped_correction.correction_request_id=a.target_id AND scoped_correction.container_id=scoped_event.container_id))
             )
        ))
      )`, locationIds);
    }
    if (filters.from) add("a.occurred_at >= $VALUE::timestamptz", filters.from);
    if (filters.to) add("a.occurred_at < $VALUE::timestamptz", filters.to);
    const where = clauses.join(" AND ");
    const queryValues = [...values, safeLimit, safeOffset];
    return this.transaction(async (client) => {
      const joins = `
           FROM audit_log a
           LEFT JOIN admin_users u ON u.tenant_id=a.tenant_id AND u.user_id=a.actor_id
           LEFT JOIN devices target_device ON target_device.tenant_id=a.tenant_id AND a.target_type='device' AND a.target_id=target_device.device_id
           LEFT JOIN containers target_container ON target_container.tenant_id=a.tenant_id AND a.target_type='container' AND a.target_id=target_container.container_id
           LEFT JOIN review_cases target_review ON target_review.tenant_id=a.tenant_id AND a.target_type='review_case' AND a.target_id=target_review.review_case_id
           LEFT JOIN containers target_review_container ON target_review_container.tenant_id=target_review.tenant_id AND target_review.container_id=target_review_container.container_id
           LEFT JOIN correction_requests target_correction ON target_correction.tenant_id=a.tenant_id AND a.target_type='correction_request' AND a.target_id=target_correction.correction_request_id
           LEFT JOIN containers target_correction_container ON target_correction_container.tenant_id=target_correction.tenant_id AND target_correction.container_id=target_correction_container.container_id
           LEFT JOIN LATERAL (
             SELECT l.location_id, l.location_name
               FROM locations l
              WHERE l.tenant_id=a.tenant_id
                AND (a.target_id=l.location_id
                  OR a.details->>'locationId'=l.location_id::text
                  OR a.details->>'assignedLocationId'=l.location_id::text
                  OR a.details->>'previousLocationId'=l.location_id::text
                  OR a.details->'after'->>'assignedLocationId'=l.location_id::text
                  OR a.details->'after'->>'assigned_location_id'=l.location_id::text
                  OR a.details->'before'->>'assignedLocationId'=l.location_id::text
                  OR a.details->'before'->>'assigned_location_id'=l.location_id::text)
              ORDER BY l.location_name
              LIMIT 1
           ) audit_location ON true`;
      const [countResult, result] = await Promise.all([
        client.query<{ count: string }>(`SELECT count(*)::text AS count ${joins} WHERE ${where}`, values),
        client.query(`SELECT a.audit_id, a.occurred_at, a.actor_type, a.action, a.target_type, a.target_id, a.details,
                u.user_id AS actor_user_id, u.username AS actor_username, u.display_name AS actor_display_name,
                COALESCE(target_device.device_label, target_container.container_label, target_review_container.container_label, target_correction_container.container_label,
                  CASE a.target_type
                    WHEN 'admin_user' THEN 'Administrator account'
                    WHEN 'admin_access' THEN 'Sign-in help request'
                    WHEN 'device' THEN 'Scanner'
                    WHEN 'container' THEN 'Container'
                    WHEN 'review_case' THEN 'Review case'
                    WHEN 'correction_request' THEN 'Correction request'
                    WHEN 'location' THEN audit_location.location_name
                    ELSE NULL
                  END) AS target_label,
                audit_location.location_id, audit_location.location_name
           ${joins}
          WHERE ${where}
          ORDER BY a.occurred_at DESC, a.audit_id DESC
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          queryValues)
      ]);
      return {
        items: result.rows.map((row) => ({
          auditId: String(row.audit_id), occurredAt: new Date(row.occurred_at as Date | string).toISOString(),
          actorType: row.actor_type as AuditEntry["actorType"],
          actorDisplayName: row.actor_display_name ? String(row.actor_display_name) : row.actor_type === "system" ? "StackTrack system" : row.actor_type === "device" ? "Scanner device" : "Unknown administrator",
          actorUsername: row.actor_username ? String(row.actor_username) : null,
          action: String(row.action), targetType: String(row.target_type), targetId: row.target_id ? String(row.target_id) : null,
          targetLabel: row.target_label ? String(row.target_label) : null,
          locationId: row.location_id ? String(row.location_id) : null,
          locationName: row.location_name ? String(row.location_name) : null,
          details: (row.details ?? {}) as Record<string, unknown>
        })),
        total: Number(countResult.rows[0]?.count ?? 0),
        limit: safeLimit,
        offset: safeOffset
      };
    });
  }

  public async createUser(actor: AdminPrincipal, input: NewAdminUser): Promise<AdminPrincipal> {
    if (actor.role !== "organization_owner") throw new Error("Only Organization Owners can add administrators.");
    const username = validateUsername(input.username);
    const displayName = validateDisplayName(input.displayName);
    validateManagedRole(input.role);
    validatePassword(input.temporaryPassword, "Temporary password");
    const locationIds = normalizeLocationIds(input.locationIds);
    if (input.role === "location_manager" && locationIds.length === 0) {
      throw new Error("Assign at least one operating location to a Location Manager.");
    }
    if (input.role !== "location_manager" && input.role !== "read_only_reviewer" && locationIds.length > 0) {
      throw new Error("Location assignments are only valid for Location Managers or scoped Read-only Reviewers.");
    }
    const passwordHash = await hashPassword(input.temporaryPassword);
    return this.transaction(async (client) => {
      if (locationIds.length > 0) {
        const locations = await client.query(
          `SELECT location_id
            FROM locations
            WHERE tenant_id=$1 AND is_active
              AND lower(location_name) NOT IN ('unknown location', 'in transit')
              AND location_id = ANY($2::uuid[])`,
          [this.tenantId, locationIds]
        );
        if (locations.rows.length !== locationIds.length) {
          throw new Error("Every assigned location must be an active location in this organization.");
        }
      }
      const result = await client.query(
        `INSERT INTO admin_users (tenant_id,username,display_name,role,password_hash,must_change_password)
         VALUES ($1,$2,$3,$4,$5,true)
         RETURNING tenant_id,user_id,username,display_name,role,support_expires_at,is_active,must_change_password`,
        [this.tenantId, username, displayName, input.role, passwordHash]
      );
      const user = { ...rowPrincipal(result.rows[0]), locationIds };
      for (const locationId of locationIds) {
        await client.query(
          `INSERT INTO admin_user_locations (tenant_id,user_id,location_id,assigned_by)
           VALUES ($1,$2,$3,$4)`,
          [this.tenantId, user.userId, locationId, actor.userId]
        );
      }
      await this.audit(client, actor, "admin.user_created", user.userId, {
        username: user.username,
        role: user.role,
        locationIds
      });
      return user;
    });
  }

  /**
   * Record a sign-in help request without revealing whether the account exists.
   * The request is deliberately an append-only system audit event so corporate
   * administrators can find it after signing in, while no password or session
   * data is ever accepted from the public form.
   */
  public async requestAccessHelp(usernameInput: string | undefined, messageInput: string): Promise<{ requestId: string; occurredAt: string }> {
    const username = normalizeAccessHelpUsername(usernameInput);
    const message = validateAccessHelpMessage(messageInput);
    return this.transaction(async (client) => {
      const result = await client.query<{ audit_id: string; occurred_at: Date | string }>(
        `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target_type, target_id, details)
         VALUES ($1,'system',NULL,'admin.access_issue_requested','admin_access',NULL,$2::jsonb)
         RETURNING audit_id, occurred_at`,
        [this.tenantId, JSON.stringify({ username, message, source: "sign_in" })]
      );
      const row = result.rows[0];
      if (!row) throw new Error("The sign-in help request could not be recorded.");
      return { requestId: String(row.audit_id), occurredAt: new Date(row.occurred_at).toISOString() };
    });
  }

  public async updateUser(actor: AdminPrincipal, userId: string, input: AdminUserUpdate): Promise<AdminPrincipal> {
    if (actor.role !== "organization_owner") throw new Error("Only Organization Owners can manage administrator accounts.");
    if (input.role !== undefined) validateManagedRole(input.role);
    if (input.displayName !== undefined) validateDisplayName(input.displayName);
    if (input.role === undefined && input.displayName === undefined && input.isActive === undefined && input.locationIds === undefined) throw new Error("Choose at least one administrator account change.");
    return this.transaction(async (client) => {
      const found = await client.query(`SELECT u.tenant_id,u.user_id,u.username,u.display_name,u.role,u.support_expires_at,u.is_active,u.must_change_password,
                (SELECT COALESCE(array_agg(scope.location_id::text ORDER BY scope.location_id), ARRAY[]::text[])
                   FROM admin_user_locations scope
                  WHERE scope.tenant_id = u.tenant_id AND scope.user_id = u.user_id) AS location_ids
           FROM admin_users u WHERE u.tenant_id=$1 AND u.user_id=$2 FOR UPDATE`, [this.tenantId, userId]);
      const target = found.rows[0] as AdminRow | undefined;
      if (!target) throw new Error("Administrator account was not found.");
      const existing = rowPrincipal(target);
      if (existing.userId === actor.userId && (input.role !== undefined || input.isActive === false || input.locationIds !== undefined)) {
        throw new Error("Use another Organization Owner to change your own role or disable your account.");
      }
      const role = input.role ?? existing.role;
      const isActive = input.isActive ?? existing.isActive;
      const displayName = input.displayName === undefined ? existing.displayName : validateDisplayName(input.displayName);
      const requestedLocationIds = input.locationIds === undefined
        ? (existing.locationIds ?? [])
        : normalizeLocationIds(input.locationIds);
      if (role === "location_manager" && requestedLocationIds.length === 0) {
        throw new Error("Assign at least one operating location to a Location Manager.");
      }
      if (role !== "location_manager" && role !== "read_only_reviewer" && input.locationIds !== undefined && requestedLocationIds.length > 0) {
        throw new Error("Location assignments are only valid for Location Managers or scoped Read-only Reviewers.");
      }
      const locationIds = role === "location_manager" || role === "read_only_reviewer" ? requestedLocationIds : [];
      if (locationIds.length > 0) {
        const locations = await client.query(
          `SELECT location_id
            FROM locations
            WHERE tenant_id=$1 AND is_active
              AND lower(location_name) NOT IN ('unknown location', 'in transit')
              AND location_id = ANY($2::uuid[])`,
          [this.tenantId, locationIds]
        );
        if (locations.rows.length !== locationIds.length) {
          throw new Error("Every assigned location must be an active location in this organization.");
        }
      }
      if (existing.role === "organization_owner" && (role !== "organization_owner" || !isActive)) {
        const count = await client.query(`SELECT count(*)::int AS count FROM admin_users WHERE tenant_id=$1 AND role='organization_owner' AND is_active AND user_id <> $2`, [this.tenantId, existing.userId]);
        if (Number(count.rows[0]?.count ?? 0) < 1) throw new Error("StackTrack must retain at least one active Organization Owner.");
      }
      const updated = await client.query(
        `UPDATE admin_users SET display_name=$3, role=$4, is_active=$5, updated_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2
         RETURNING tenant_id,user_id,username,display_name,role,support_expires_at,is_active,must_change_password`,
        [this.tenantId, existing.userId, displayName, role, isActive]
      );
      if (!isActive || role !== existing.role) {
        await client.query(`UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL`, [this.tenantId, existing.userId]);
      }
      await client.query(`DELETE FROM admin_user_locations WHERE tenant_id=$1 AND user_id=$2`, [this.tenantId, existing.userId]);
      for (const locationId of locationIds) {
        await client.query(
          `INSERT INTO admin_user_locations (tenant_id,user_id,location_id,assigned_by)
           VALUES ($1,$2,$3,$4)`,
          [this.tenantId, existing.userId, locationId, actor.userId]
        );
      }
      const user = { ...rowPrincipal(updated.rows[0]), locationIds };
      await this.audit(client, actor, "admin.user_updated", user.userId, {
        before: { displayName: existing.displayName, role: existing.role, isActive: existing.isActive, locationIds: existing.locationIds },
        after: { displayName: user.displayName, role: user.role, isActive: user.isActive, locationIds },
        sessionsRevoked: !isActive || role !== existing.role
      });
      return user;
    });
  }

  /** Permanently remove an administrator profile while retaining the audit trail. */
  public async removeUser(actor: AdminPrincipal, userId: string, confirmation: string): Promise<AdminUserRemoval> {
    if (actor.role !== "organization_owner") {
      throw new Error("Only Organization Owners can permanently remove administrator accounts.");
    }
    return this.transaction(async (client) => {
      const found = await client.query(
        `SELECT u.tenant_id,u.user_id,u.username,u.display_name,u.role,u.support_expires_at,u.is_active,u.must_change_password,
                (SELECT COALESCE(array_agg(scope.location_id::text ORDER BY scope.location_id), ARRAY[]::text[])
                   FROM admin_user_locations scope
                  WHERE scope.tenant_id = u.tenant_id AND scope.user_id = u.user_id) AS location_ids
           FROM admin_users u
          WHERE u.tenant_id=$1 AND u.user_id=$2
          FOR UPDATE`,
        [this.tenantId, userId]
      );
      const target = found.rows[0] as AdminRow | undefined;
      if (!target) throw new Error("Administrator account was not found. It may already have been removed.");
      const existing = rowPrincipal(target);
      if (existing.userId === actor.userId) {
        throw new Error("Use another Organization Owner to remove your account.");
      }
      if (confirmation.trim().toLowerCase() !== existing.username) {
        throw new Error(`Type ${existing.username} exactly to confirm permanent removal.`);
      }
      if (existing.role === "organization_owner") {
        const count = await client.query(
          `SELECT count(*)::int AS count
             FROM admin_users
            WHERE tenant_id=$1 AND role='organization_owner' AND is_active AND user_id <> $2`,
          [this.tenantId, existing.userId]
        );
        if (Number(count.rows[0]?.count ?? 0) < 1) {
          throw new Error("StackTrack must retain at least one active Organization Owner.");
        }
      }

      // Revoke dependent sessions and detach historical assignment ownership
      // before deleting the profile. Audit records remain append-only.
      await client.query(`DELETE FROM admin_sessions WHERE tenant_id=$1 AND user_id=$2`, [this.tenantId, existing.userId]);
      await client.query(`UPDATE admin_user_locations SET assigned_by=NULL WHERE tenant_id=$1 AND assigned_by=$2`, [this.tenantId, existing.userId]);
      await client.query(`DELETE FROM admin_user_locations WHERE tenant_id=$1 AND user_id=$2`, [this.tenantId, existing.userId]);
      await this.audit(client, actor, "admin.user_removed", existing.userId, {
        removedUsername: existing.username,
        removedDisplayName: existing.displayName,
        removedRole: existing.role,
        removedLocationIds: existing.locationIds ?? [],
        sessionsRevoked: true
      });
      await client.query(`DELETE FROM admin_users WHERE tenant_id=$1 AND user_id=$2`, [this.tenantId, existing.userId]);
      return { userId: existing.userId, username: existing.username, displayName: existing.displayName, role: existing.role };
    });
  }

  public async resetUserPassword(
    actor: AdminPrincipal,
    userId: string,
    temporaryPassword: string,
    reasonInput = "Owner initiated password reset"
  ): Promise<AdminPrincipal> {
    if (actor.role !== "organization_owner") {
      throw new Error("Only Organization Owners can reset administrator passwords.");
    }
    if (actor.userId === userId) {
      throw new Error("Use your own account security form to change your password.");
    }
    validatePassword(temporaryPassword, "Temporary password");
    const reason = validateAdminActionReason(reasonInput);
    const passwordHash = await hashPassword(temporaryPassword);
    return this.transaction(async (client) => {
      const found = await client.query(
        `SELECT u.tenant_id,u.user_id,u.username,u.display_name,u.role,u.support_expires_at,u.is_active,u.must_change_password,
                (SELECT COALESCE(array_agg(scope.location_id::text ORDER BY scope.location_id), ARRAY[]::text[])
                   FROM admin_user_locations scope
                  WHERE scope.tenant_id = u.tenant_id AND scope.user_id = u.user_id) AS location_ids
           FROM admin_users u
          WHERE tenant_id=$1 AND user_id=$2
          FOR UPDATE`,
        [this.tenantId, userId]
      );
      const target = found.rows[0] as AdminRow | undefined;
      if (!target) throw new Error("Administrator account was not found.");
      if (!Boolean(target.is_active)) throw new Error("Enable the administrator account before issuing a password.");
      await client.query(
        `UPDATE admin_users
            SET password_hash=$3, must_change_password=true, updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND user_id=$2`,
        [this.tenantId, userId, passwordHash]
      );
      await client.query(
        `UPDATE admin_sessions
            SET revoked_at=clock_timestamp()
          WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL`,
        [this.tenantId, userId]
      );
      const user = rowPrincipal({ ...target, must_change_password: true });
      await this.audit(client, actor, "admin.password_reset", user.userId, {
        username: user.username,
        reason,
        sessionsRevoked: true,
        mustChangePassword: true
      });
      return user;
    });
  }
}
