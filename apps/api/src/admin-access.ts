import { createHash, pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Pool, PoolClient } from "pg";

const pbkdf2 = promisify(pbkdf2Callback);
const passwordIterations = 210_000;
const sessionLifetimeMs = 1000 * 60 * 60 * 12;

export type AdminRole = "organization_owner" | "operations_administrator" | "read_only_reviewer" | "support";

export interface AdminPrincipal {
  readonly tenantId: string;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: AdminRole;
  readonly supportExpiresAt: string | null;
}

export interface AdminSession {
  readonly token: string;
  readonly principal: AdminPrincipal;
  readonly expiresAt: string;
}

export interface NewAdminUser {
  readonly username: string;
  readonly displayName: string;
  readonly role: Exclude<AdminRole, "organization_owner" | "support">;
  readonly temporaryPassword: string;
}

function rowPrincipal(row: Record<string, unknown>): AdminPrincipal {
  return {
    tenantId: String(row.tenant_id), userId: String(row.user_id), username: String(row.username),
    displayName: String(row.display_name), role: row.role as AdminRole,
    supportExpiresAt: row.support_expires_at ? new Date(String(row.support_expires_at)).toISOString() : null
  };
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

  public async signIn(usernameInput: string, password: string): Promise<AdminSession | null> {
    const username = usernameInput.trim().toLowerCase();
    return this.transaction(async (client) => {
      const user = await client.query(
        `SELECT tenant_id, user_id, username, display_name, role, support_expires_at, password_hash
           FROM admin_users
          WHERE tenant_id = $1 AND username = $2 AND is_active
            AND (support_expires_at IS NULL OR support_expires_at > clock_timestamp())`,
        [this.tenantId, username]
      );
      const row = user.rows[0];
      if (!row?.password_hash || !(await verifyPassword(password, row.password_hash))) return null;
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
      await client.query(
        `INSERT INTO admin_sessions (tenant_id, user_id, token_sha256, expires_at)
         VALUES ($1,$2,$3,$4)`, [this.tenantId, row.user_id, tokenHash, expiresAt]
      );
      await client.query(
        `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target_type, target_id, details)
         VALUES ($1,'user',$2,'admin.signed_in','admin_user',$2,$3::jsonb)`,
        [this.tenantId, row.user_id, JSON.stringify({ username, source: "admin_console" })]
      );
      return { token, principal: rowPrincipal(row), expiresAt };
    });
  }

  public async authenticate(token: string): Promise<AdminPrincipal | null> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    return this.transaction(async (client) => {
      const found = await client.query(
        `SELECT u.tenant_id, u.user_id, u.username, u.display_name, u.role, u.support_expires_at
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

  public async listUsers(): Promise<AdminPrincipal[]> {
    return this.transaction(async (client) => {
      const result = await client.query(`SELECT tenant_id,user_id,username,display_name,role,support_expires_at FROM admin_users WHERE tenant_id=$1 ORDER BY role, username`, [this.tenantId]);
      return result.rows.map(rowPrincipal);
    });
  }

  public async createUser(actor: AdminPrincipal, input: NewAdminUser): Promise<AdminPrincipal> {
    const username = input.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new Error("Username must use 3–64 lowercase letters, numbers, periods, underscores, or hyphens.");
    if (input.temporaryPassword.length < 12) throw new Error("Temporary password must be at least 12 characters.");
    const passwordHash = await hashPassword(input.temporaryPassword);
    return this.transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO admin_users (tenant_id,username,display_name,role,password_hash,must_change_password)
         VALUES ($1,$2,$3,$4,$5,true)
         RETURNING tenant_id,user_id,username,display_name,role,support_expires_at`,
        [this.tenantId, username, input.displayName.trim(), input.role, passwordHash]
      );
      const user = rowPrincipal(result.rows[0]);
      await client.query(
        `INSERT INTO audit_log (tenant_id,actor_type,actor_id,action,target_type,target_id,details)
         VALUES ($1,'user',$2,'admin.user_created','admin_user',$3,$4::jsonb)`,
        [this.tenantId, actor.userId, user.userId, JSON.stringify({ username:user.username, role:user.role })]
      );
      return user;
    });
  }
}
