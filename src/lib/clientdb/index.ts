import "server-only";
import { Client, type QueryResult } from "pg";
import { checkReadQuery, checkSchemaChange } from "./guard";

// Acceso a la base de datos del cliente. Cada función abre y cierra su propia
// conexión: nada queda abierto entre pasos del agente.

const MAX_ROWS = 50;
const MAX_CELL = 200;
const BACKUP_ROWS_PER_TABLE = 10_000;
const BACKUP_MAX_BYTES = 40 * 1024 * 1024;
const SKIP_SCHEMAS = [
  "pg_catalog", "information_schema", "pg_toast", "auth", "storage", "vault", "pgsodium", "pgsodium_masks",
  "realtime", "extensions", "graphql", "graphql_public", "net", "cron", "pgbouncer", "supabase_functions",
  "supabase_migrations", "_realtime", "_analytics",
];

function clientFor(url: string): Client {
  const parsed = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  // sslmode en la URL pisaría la configuración explícita de pg.
  parsed.searchParams.delete("sslmode");
  return new Client({
    connectionString: parsed.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8_000,
    application_name: "autosana",
  });
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = clientFor(url);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/** Texto para mostrar la conexión sin la contraseña. */
export function describeUrl(url: string): string {
  const u = new URL(url);
  return `${u.username ? `${u.username}@` : ""}${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
}

export function isPostgresUrl(url: string): boolean {
  try {
    return ["postgres:", "postgresql:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

// ── Lectura ───────────────────────────────────────────────────

function trimCell(v: unknown): unknown {
  if (v === null || typeof v === "number" || typeof v === "boolean") return v;
  const s = typeof v === "string" ? v : v instanceof Date ? v.toISOString() : JSON.stringify(v);
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s;
}

/** Ejecuta una sola consulta SELECT dentro de una transacción READ ONLY. */
export async function readOnlyQuery(url: string, sql: string): Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean }> {
  const check = checkReadQuery(sql);
  if (!check.ok) throw new Error(check.reason);
  return withClient(url, async (c) => {
    await c.query("BEGIN TRANSACTION READ ONLY");
    try {
      await c.query("SET LOCAL statement_timeout = '5s'");
      await c.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
      const res: QueryResult = await c.query({ text: check.statements[0], rowMode: "array" });
      const columns = res.fields.map((f) => f.name);
      const rows = (res.rows as unknown[][]).slice(0, MAX_ROWS).map((r) => r.map(trimCell));
      return { columns, rows, truncated: res.rows.length > MAX_ROWS };
    } finally {
      // Siempre ROLLBACK: aunque algo se colara, nada se guarda.
      await c.query("ROLLBACK").catch(() => {});
    }
  });
}

/** Resumen compacto del esquema para el agente: tabla(col tipo, …). */
export async function describeSchema(url: string): Promise<string> {
  return withClient(url, async (c) => {
    await c.query("BEGIN TRANSACTION READ ONLY");
    try {
      const res = await c.query<{ table_schema: string; table_name: string; cols: string }>(
        `select table_schema, table_name,
                string_agg(column_name || ' ' || data_type || case when is_nullable = 'NO' then ' not null' else '' end, ', ' order by ordinal_position) as cols
           from information_schema.columns
          where table_schema <> all($1::text[])
          group by table_schema, table_name
          order by table_schema, table_name
          limit 80`,
        [SKIP_SCHEMAS],
      );
      return res.rows.map((r) => `${r.table_schema === "public" ? "" : `${r.table_schema}.`}${r.table_name}(${r.cols})`).join("\n");
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  });
}

export async function testConnection(url: string): Promise<{ tables: number }> {
  return withClient(url, async (c) => {
    const res = await c.query<{ n: string }>(
      "select count(*)::text as n from information_schema.tables where table_schema <> all($1::text[])",
      [SKIP_SCHEMAS],
    );
    return { tables: Number(res.rows[0]?.n ?? 0) };
  });
}

// ── Cambios de estructura ─────────────────────────────────────

async function runSchemaChange(url: string, sql: string, commit: boolean): Promise<void> {
  const check = checkSchemaChange(sql);
  if (!check.ok) throw new Error(check.reason);
  await withClient(url, async (c) => {
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL statement_timeout = '15s'");
      await c.query("SET LOCAL lock_timeout = '3s'");
      for (const stmt of check.statements) await c.query(stmt);
      await c.query(commit ? "COMMIT" : "ROLLBACK");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    }
  });
}

/** Entorno de pruebas: aplica el cambio dentro de una transacción y la deshace. */
export function dryRunSchemaChange(url: string, sql: string) {
  return runSchemaChange(url, sql, false);
}

/** Aplica el cambio de verdad (todo o nada). Llamar solo después de un respaldo. */
export function applySchemaChange(url: string, sql: string) {
  return runSchemaChange(url, sql, true);
}

// ── Respaldo ──────────────────────────────────────────────────

export type Snapshot = {
  version: 1;
  createdAt: string;
  database: string;
  tables: {
    schema: string;
    name: string;
    columns: { name: string; type: string; nullable: boolean; default: string | null }[];
    constraints: string[];
    indexes: string[];
    rows: unknown[];
    truncated: boolean;
  }[];
};

/** Foto consistente (REPEATABLE READ, solo lectura) de estructura y datos. */
export async function snapshot(url: string): Promise<{ snapshot: Snapshot; rows: number }> {
  return withClient(url, async (c) => {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      await c.query("SET LOCAL statement_timeout = '60s'");
      const tables = await c.query<{ schema: string; name: string; oid: string }>(
        `select n.nspname as schema, c.relname as name, c.oid::text as oid
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'p') and n.nspname <> all($1::text[]) and n.nspname not like 'pg_%'
          order by 1, 2`,
        [SKIP_SCHEMAS],
      );
      const out: Snapshot = { version: 1, createdAt: new Date().toISOString(), database: describeUrl(url), tables: [] };
      let bytes = 0;
      let total = 0;
      for (const t of tables.rows) {
        const cols = await c.query<{ name: string; type: string; nullable: boolean; default: string | null }>(
          `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, not a.attnotnull as nullable,
                  pg_get_expr(d.adbin, d.adrelid) as default
             from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where a.attrelid = $1::oid and a.attnum > 0 and not a.attisdropped order by a.attnum`,
          [t.oid],
        );
        const cons = await c.query<{ def: string }>(
          "select conname || ' ' || pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1::oid",
          [t.oid],
        );
        const idx = await c.query<{ def: string }>("select pg_get_indexdef(indexrelid) as def from pg_index where indrelid = $1::oid", [t.oid]);
        const ident = `${c.escapeIdentifier(t.schema)}.${c.escapeIdentifier(t.name)}`;
        const data = bytes < BACKUP_MAX_BYTES
          ? await c.query(`select * from ${ident} limit ${BACKUP_ROWS_PER_TABLE + 1}`)
          : { rows: [] as unknown[] };
        const rows = data.rows.slice(0, BACKUP_ROWS_PER_TABLE);
        bytes += JSON.stringify(rows).length;
        total += rows.length;
        out.tables.push({
          schema: t.schema,
          name: t.name,
          columns: cols.rows,
          constraints: cons.rows.map((r) => r.def),
          indexes: idx.rows.map((r) => r.def),
          rows,
          truncated: data.rows.length > BACKUP_ROWS_PER_TABLE || bytes >= BACKUP_MAX_BYTES,
        });
      }
      return { snapshot: out, rows: total };
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  });
}
