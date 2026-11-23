import "server-only";
import { Client, type QueryResult } from "pg";
import { assertPublicHost } from "../scans/common";
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
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  // sslmode en la URL pisaría la configuración explícita de pg.
  parsed.searchParams.delete("sslmode");
  return new Client({
    connectionString: parsed.toString(),
    // Cifrado sin verificar la cadena: Supabase (directo y pooler) y RDS firman con su
    // propia CA, que no está en el almacén de Node; verificar rompería esas conexiones.
    ssl: local ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8_000,
    application_name: "fixie",
  });
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  // En producción, la URL que pega el usuario no puede llevar a la red interna de Fixie.
  await assertPublicHost(new URL(url).hostname);
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

// ── Estructura para el entorno de pruebas ─────────────────────

/**
 * SQL que recrea la estructura de la base (sin ninguna fila) en una base
 * desechable: esquemas, tipos, secuencias, funciones, tablas, restricciones,
 * índices, vistas, RLS con sus políticas y triggers. Solo lee, dentro de una
 * transacción de solo lectura. Se aplica sin detenerse en errores, así que cada
 * sentencia va sola.
 */
export async function schemaDDL(url: string): Promise<string> {
  return withClient(url, async (c) => {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      await c.query("SET LOCAL statement_timeout = '30s'");
      // Con este search_path, lo que no esté en public sale calificado (extensions.uuid_generate_v4()…).
      await c.query("SET LOCAL search_path = pg_catalog, public");
      const skip = [SKIP_SCHEMAS];
      const q = <T extends Record<string, unknown>>(sql: string) => c.query<T>(sql, skip).then((r) => r.rows);
      const id = (s: string) => c.escapeIdentifier(s);
      const lit = (s: string) => c.escapeLiteral(s);
      const qual = (schema: string, name: string) => `${id(schema)}.${id(name)}`;
      const userNs = "n.nspname <> all($1::text[]) and n.nspname not like 'pg\\_%'";
      // Objetos que trae una extensión: se crean con la extensión, no a mano.
      const notExt = (oid: string, catalog: string) =>
        `not exists (select 1 from pg_depend d where d.objid = ${oid} and d.classid = '${catalog}'::regclass and d.deptype = 'e')`;

      const out: string[] = ["SET check_function_bodies = off"];

      // En su mismo esquema: los defaults salen calificados (extensions.uuid_generate_v4()),
      // así que en una base Postgres limpia el esquema tiene que existir.
      for (const r of await q<{ extname: string; schema: string }>(
        "select e.extname, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname <> 'plpgsql' and $1::text[] is not null",
      )) {
        if (r.schema !== "public" && r.schema !== "pg_catalog") out.push(`CREATE SCHEMA IF NOT EXISTS ${id(r.schema)}`);
        out.push(`CREATE EXTENSION IF NOT EXISTS ${id(r.extname)} WITH SCHEMA ${id(r.schema)}`);
      }
      for (const r of await q<{ nspname: string }>(`select n.nspname from pg_namespace n where ${userNs} and n.nspname <> 'public'`)) {
        out.push(`CREATE SCHEMA IF NOT EXISTS ${id(r.nspname)}`);
      }
      for (const r of await q<{ schema: string; name: string; labels: string[] }>(
        `select n.nspname as schema, t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
           from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid
          where ${userNs} and ${notExt("t.oid", "pg_type")} group by 1, 2`,
      )) {
        out.push(`CREATE TYPE ${qual(r.schema, r.name)} AS ENUM (${r.labels.map(lit).join(", ")})`);
      }
      // Dominios, tipos compuestos y rangos, en orden de creación (uno puede usar otro).
      // Sin ellos, las tablas que los usan no se crean en la copia.
      const types: { oid: number; sql: string }[] = [];
      for (const r of await q<{ oid: number; schema: string; name: string; base: string; notnull: boolean; def: string | null; checks: string[] }>(
        `select t.oid::int as oid, n.nspname as schema, t.typname as name, format_type(t.typbasetype, t.typtypmod) as base,
                t.typnotnull as notnull, t.typdefault as def,
                coalesce(array_agg(pg_get_constraintdef(k.oid) order by k.oid) filter (where k.oid is not null), '{}')::text[] as checks
           from pg_type t join pg_namespace n on n.oid = t.typnamespace left join pg_constraint k on k.contypid = t.oid
          where t.typtype = 'd' and ${userNs} and ${notExt("t.oid", "pg_type")}
          group by t.oid, n.nspname, t.typname, t.typbasetype, t.typtypmod, t.typnotnull, t.typdefault`,
      )) {
        const parts = [`CREATE DOMAIN ${qual(r.schema, r.name)} AS ${r.base}`];
        if (r.def) parts.push(`DEFAULT ${r.def}`);
        // Desde Postgres 17 el NOT NULL del dominio también sale como restricción: no se repite.
        if (r.notnull && !r.checks.some((k) => /^not null/i.test(k))) parts.push("NOT NULL");
        parts.push(...r.checks);
        types.push({ oid: r.oid, sql: parts.join(" ") });
      }
      for (const r of await q<{ oid: number; schema: string; name: string; attrs: string[] }>(
        `select t.oid::int as oid, n.nspname as schema, t.typname as name,
                array_agg(quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod) order by a.attnum)::text[] as attrs
           from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_class c on c.oid = t.typrelid
           join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          where t.typtype = 'c' and c.relkind = 'c' and ${userNs} and ${notExt("t.oid", "pg_type")}
          group by t.oid, n.nspname, t.typname`,
      )) {
        types.push({ oid: r.oid, sql: `CREATE TYPE ${qual(r.schema, r.name)} AS (${r.attrs.join(", ")})` });
      }
      for (const r of await q<{ oid: number; schema: string; name: string; subtype: string }>(
        `select t.oid::int as oid, n.nspname as schema, t.typname as name, format_type(g.rngsubtype, null) as subtype
           from pg_range g join pg_type t on t.oid = g.rngtypid join pg_namespace n on n.oid = t.typnamespace
          where ${userNs} and ${notExt("t.oid", "pg_type")}`,
      )) {
        types.push({ oid: r.oid, sql: `CREATE TYPE ${qual(r.schema, r.name)} AS RANGE (SUBTYPE = ${r.subtype})` });
      }
      out.push(...types.sort((a, b) => a.oid - b.oid).map((t) => t.sql));
      for (const r of await q<{ schema: string; name: string }>(
        `select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind = 'S' and ${userNs} and ${notExt("c.oid", "pg_class")}
            and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'i')`,
      )) {
        out.push(`CREATE SEQUENCE IF NOT EXISTS ${qual(r.schema, r.name)}`);
      }
      // Las funciones que reciben o devuelven filas de una tabla (RETURNS SETOF perfiles…)
      // necesitan la tabla creada: van después de las tablas. El resto, antes (defaults y checks las usan).
      const lateFns: string[] = [];
      for (const r of await q<{ def: string; late: boolean }>(
        `select pg_get_functiondef(p.oid) as def,
                exists (select 1 from pg_type t left join pg_type e on e.oid = t.typelem
                         where (t.typrelid <> 0 or coalesce(e.typrelid, 0) <> 0)
                           and (t.oid = p.prorettype or t.oid = any(p.proargtypes::oid[]) or t.oid = any(coalesce(p.proallargtypes, '{}'::oid[])))) as late
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where ${userNs} and p.prokind in ('f', 'p') and ${notExt("p.oid", "pg_proc")}
            -- Los constructores de un rango (price_range(), price_multirange()…) los crea el propio tipo.
            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'i')`,
      )) {
        (r.late ? lateFns : out).push(r.def.trim());
      }

      const tables = await q<{ oid: string; schema: string; name: string; rls: boolean; force: boolean }>(
        `select c.oid::text as oid, n.nspname as schema, c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'p') and ${userNs} and ${notExt("c.oid", "pg_class")} order by 2, 3`,
      );
      const fks: string[] = [];
      const after: string[] = [];
      for (const t of tables) {
        const name = qual(t.schema, t.name);
        const cols = await c.query<{ name: string; type: string; notnull: boolean; def: string | null; identity: string; generated: string }>(
          `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull,
                  pg_get_expr(d.adbin, d.adrelid) as def, a.attidentity as identity, a.attgenerated as generated
             from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where a.attrelid = $1::oid and a.attnum > 0 and not a.attisdropped order by a.attnum`,
          [t.oid],
        );
        const lines = cols.rows.map((col) => {
          const extra =
            col.generated === "s" && col.def
              ? ` GENERATED ALWAYS AS (${col.def}) STORED`
              : col.identity
                ? ` GENERATED ${col.identity === "a" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY`
                : col.def
                  ? ` DEFAULT ${col.def}`
                  : "";
          return `  ${id(col.name)} ${col.type}${extra}${col.notnull ? " NOT NULL" : ""}`;
        });
        out.push(`CREATE TABLE IF NOT EXISTS ${name} (\n${lines.join(",\n")}\n)`);

        const cons = await c.query<{ name: string; type: string; def: string }>(
          "select conname as name, contype as type, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1::oid and contype in ('p', 'u', 'c', 'f', 'x') order by contype = 'f', conname",
          [t.oid],
        );
        for (const k of cons.rows) {
          const stmt = `ALTER TABLE ${name} ADD CONSTRAINT ${id(k.name)} ${k.def}`;
          (k.type === "f" ? fks : out).push(stmt);
        }
        const idx = await c.query<{ def: string }>(
          "select pg_get_indexdef(i.indexrelid) as def from pg_index i where i.indrelid = $1::oid and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)",
          [t.oid],
        );
        for (const i of idx.rows) out.push(i.def);
        if (t.rls) after.push(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY`);
        if (t.force) after.push(`ALTER TABLE ${name} FORCE ROW LEVEL SECURITY`);
      }
      out.push(...fks);
      out.push(...lateFns);

      // En orden de creación (una vista puede usar otra). Se conservan las opciones:
      // sin security_invoker, la copia saltaría el RLS y Shannon reportaría un fallo que
      // producción no tiene. Las materializadas, sin datos.
      for (const r of await q<{ schema: string; name: string; kind: string; def: string; opts: string | null }>(
        `select n.nspname as schema, c.relname as name, c.relkind::text as kind, pg_get_viewdef(c.oid) as def, array_to_string(c.reloptions, ', ') as opts
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('v', 'm') and ${userNs} and ${notExt("c.oid", "pg_class")} order by c.oid`,
      )) {
        const def = r.def.trim().replace(/;$/, "");
        out.push(
          r.kind === "m"
            ? `CREATE MATERIALIZED VIEW IF NOT EXISTS ${qual(r.schema, r.name)} AS ${def} WITH NO DATA`
            : `CREATE OR REPLACE VIEW ${qual(r.schema, r.name)}${r.opts ? ` WITH (${r.opts})` : ""} AS ${def}`,
        );
      }
      out.push(...after);
      for (const r of await q<{ schema: string; table: string; name: string; permissive: string; cmd: string; roles: string[]; qual: string | null; check: string | null }>(
        `select schemaname as schema, tablename as table, policyname as name, permissive, cmd, roles::text[] as roles, qual, with_check as check
           from pg_policies where schemaname <> all($1::text[])`,
      )) {
        const roles = r.roles.map((x) => (x === "public" ? "public" : id(x))).join(", ");
        out.push(
          `CREATE POLICY ${id(r.name)} ON ${qual(r.schema, r.table)} AS ${r.permissive} FOR ${r.cmd} TO ${roles}` +
            (r.qual ? ` USING (${r.qual})` : "") +
            (r.check ? ` WITH CHECK (${r.check})` : ""),
        );
      }
      // También los triggers propios sobre auth.users (el clásico on_auth_user_created que
      // crea el perfil): sin ellos, la cuenta de prueba queda sin sus filas asociadas.
      for (const r of await q<{ def: string }>(
        `select pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
           join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
          where not t.tgisinternal
            and (${userNs} or (n.nspname = 'auth' and pn.nspname <> all($1::text[]) and pn.nspname not like 'pg\\_%'))`,
      )) {
        out.push(r.def);
      }
      return out.map((s) => `${s};`).join("\n\n") + "\n";
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  });
}
