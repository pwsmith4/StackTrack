import type { Pool, PoolClient } from "pg";

export interface ContainerImportRow {
  readonly label: string;
  readonly type: string;
}

export interface ImportedContainer {
  readonly containerId: string;
  readonly label: string;
  readonly type: string;
}

export interface ContainerImportResult {
  readonly importedCount: number;
  readonly containers: readonly ImportedContainer[];
}

export interface ContainerImportErrorItem {
  readonly row: number;
  readonly message: string;
}

export class ContainerImportRejected extends Error {
  public constructor(
    message: string,
    readonly rowErrors: readonly ContainerImportErrorItem[]
  ) {
    super(message);
    this.name = "ContainerImportRejected";
  }
}

export interface ContainerAdministration {
  import(
    tenantId: string,
    actor: { readonly userId: string },
    rows: readonly ContainerImportRow[]
  ): Promise<ContainerImportResult>;
}

const MAX_IMPORT_ROWS = 10_000;
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,119}$/;

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedKey(value: string): string {
  return normalized(value).toLocaleLowerCase();
}

export class PostgresContainerAdministration implements ContainerAdministration {
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

  public async import(
    tenantId: string,
    actor: { readonly userId: string },
    rows: readonly ContainerImportRow[]
  ): Promise<ContainerImportResult> {
    return this.tenantTransaction(tenantId, async (client) => {
      if (rows.length === 0) {
        throw new ContainerImportRejected("The CSV contains no data rows.", [{ row: 2, message: "Add at least one container row below the header." }]);
      }
      if (rows.length > MAX_IMPORT_ROWS) {
        throw new ContainerImportRejected(`A single import can contain at most ${MAX_IMPORT_ROWS.toLocaleString()} data rows.`, [{ row: 2, message: `Remove rows so the file contains no more than ${MAX_IMPORT_ROWS.toLocaleString()} containers.` }]);
      }

      const typeResult = await client.query<{ container_type_id: string; type_name: string }>(
        `SELECT container_type_id, type_name
           FROM container_types
          WHERE tenant_id = $1 AND is_active`,
        [tenantId]
      );
      const types = new Map(typeResult.rows.map((row) => [normalizedKey(row.type_name), row]));
      const rowErrors: ContainerImportErrorItem[] = [];
      const seenLabels = new Map<string, number>();
      const prepared: Array<{ row: number; label: string; typeId: string; typeName: string }> = [];

      rows.forEach((input, index) => {
        const row = index + 2;
        const label = normalized(input.label);
        const type = normalized(input.type);
        if (!label) {
          rowErrors.push({ row, message: "Column 1 (label) is required." });
        } else if (!LABEL_PATTERN.test(label)) {
          rowErrors.push({ row, message: "Column 1 (label) must start with a letter or number, use only letters, numbers, spaces, periods, underscores, slashes, or hyphens, and be 120 characters or fewer." });
        }
        const typeRow = types.get(normalizedKey(type));
        if (!type) {
          rowErrors.push({ row, message: "Column 2 (container type) is required." });
        } else if (!typeRow) {
          const allowed = [...types.values()].map((item) => item.type_name).sort().join(", ");
          rowErrors.push({ row, message: `Column 2 has an inactive or unknown container type. Use one of: ${allowed || "no active types are configured"}.` });
        }
        const labelKey = normalizedKey(label);
        const firstRow = seenLabels.get(labelKey);
        if (firstRow) {
          rowErrors.push({ row, message: `This label duplicates row ${firstRow}. Every label must be unique, ignoring case and extra spaces.` });
        } else if (label) {
          seenLabels.set(labelKey, row);
        }
        if (label && LABEL_PATTERN.test(label) && typeRow) {
          prepared.push({ row, label, typeId: typeRow.container_type_id, typeName: typeRow.type_name });
        }
      });

      if (seenLabels.size > 0) {
        const existing = await client.query<{ label: string }>(
          `SELECT container_label AS label
             FROM containers
            WHERE tenant_id = $1 AND lower(container_label) = ANY($2::text[])`,
          [tenantId, [...seenLabels.keys()]]
        );
        for (const item of existing.rows) {
          const row = seenLabels.get(normalizedKey(item.label));
          if (row) rowErrors.push({ row, message: `This label already exists as “${item.label}”. Choose a new label; imports never overwrite existing containers.` });
        }
      }

      if (rowErrors.length) {
        throw new ContainerImportRejected("Nothing was imported because one or more rows need correction.", rowErrors);
      }

      const values: unknown[] = [];
      const placeholders = prepared.map((item, index) => {
        const offset = index * 4;
        values.push(tenantId, item.label, item.typeId, true);
        return `($${offset + 1}, gen_random_uuid(), $${offset + 2}, $${offset + 3}, $${offset + 4})`;
      });
      const inserted = await client.query<{ container_id: string; container_label: string; container_type_id: string }>(
        `INSERT INTO containers (tenant_id, container_id, container_label, container_type_id, is_active)
         SELECT tenant_id, container_id, container_label, container_type_id, is_active
           FROM (VALUES ${placeholders.join(", ")}) AS incoming(tenant_id, container_id, container_label, container_type_id, is_active)
        RETURNING container_id, container_label, container_type_id`,
        values
      );

      const typeById = new Map(typeResult.rows.map((item) => [item.container_type_id, item.type_name]));
      const containers = inserted.rows.map((row) => ({
        containerId: row.container_id,
        label: row.container_label,
        type: typeById.get(row.container_type_id) ?? "Unknown type"
      }));
      await client.query(
        `INSERT INTO audit_log
          (tenant_id, actor_type, actor_id, action, target_type, details)
         VALUES ($1, 'user', $2, 'containers.imported', 'container_batch', $3::jsonb)`,
        [tenantId, actor.userId, JSON.stringify({ importedCount: containers.length, source: "pilot_admin_console", atomic: true })]
      );
      return { importedCount: containers.length, containers };
    });
  }
}

export { MAX_IMPORT_ROWS };
