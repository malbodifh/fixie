/**
 * Reglas para la base de datos del cliente. La IA puede:
 *   - LEER con una sola consulta SELECT (además corre en transacción READ ONLY);
 *   - AGREGAR estructura (tablas, columnas, índices, defaults, comentarios).
 * Nunca puede borrar, modificar ni insertar datos, ni destruir estructura.
 * Estas reglas son la primera barrera; Postgres (READ ONLY, transacciones,
 * permisos del rol) es la segunda.
 */

export type GuardResult = { ok: true; statements: string[] } | { ok: false; reason: string };

/**
 * Devuelve una copia del SQL del mismo largo donde comentarios, textos entre
 * comillas e identificadores entre comillas dobles quedan en blanco. Así las
 * palabras clave se buscan solo en código real.
 */
export function mask(sql: string): { masked: string; idents: string } | { error: string } {
  const out = sql.split("");
  // Igual que `masked`, pero los identificadores entre comillas dobles conservan su
  // nombre (sin las comillas): "pg_sleep"(1) o "auth".users siguen siendo llamadas y
  // esquemas reales, y las reglas de funciones y esquemas los tienen que ver.
  const ids = sql.split("");
  let i = 0;
  const blank = (from: number, to: number, keepIdents = false) => {
    for (let k = from; k < to; k++) {
      if (out[k] === "\n") continue;
      out[k] = " ";
      if (!keepIdents) ids[k] = " ";
    }
  };
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return { error: "Comentario sin cerrar." };
      if (sql.slice(i + 2, end).includes("/*")) return { error: "Comentarios anidados no permitidos." };
      blank(i, end + 2);
      i = end + 2;
    } else if (c === "$" && /^\$[A-Za-z_]*\$/.test(sql.slice(i))) {
      return { error: "Cadenas con $$ no permitidas (podrían esconder código)." };
    } else if (c === '"' && /[uU]&\s*$/.test(sql.slice(Math.max(0, i - 3), i))) {
      return { error: 'Identificadores U&"…" no permitidos (podrían esconder nombres).' };
    } else if (c === "'" || c === '"') {
      const escaped = c === "'" && /[eE]/.test(sql[i - 1] ?? "") && !/[\w]/.test(sql[i - 2] ?? "");
      let j = i + 1;
      while (j < sql.length) {
        if (escaped && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      if (j >= sql.length) return { error: "Comillas sin cerrar." };
      const ident = c === '"';
      blank(i + 1, j, ident);
      if (ident) ids[i] = ids[j] = " ";
      i = j + 1;
    } else {
      i++;
    }
  }
  return { masked: out.join(""), idents: ids.join("") };
}

type Part = { original: string; masked: string; idents: string };

/** Separa sentencias por ';' (fuera de textos y comentarios). */
export function split(sql: string): Part[] | { error: string } {
  const m = mask(sql);
  if ("error" in m) return m;
  const parts: Part[] = [];
  let start = 0;
  for (let i = 0; i <= m.masked.length; i++) {
    if (i === m.masked.length || m.masked[i] === ";") {
      const masked = m.masked.slice(start, i);
      if (masked.trim()) parts.push({ original: sql.slice(start, i).trim(), masked: masked.trim().toLowerCase(), idents: m.idents.slice(start, i).trim().toLowerCase() });
      start = i + 1;
    }
  }
  return parts;
}

const SYSTEM_SCHEMAS = /\b(pg_catalog|information_schema|pg_toast|auth|storage|vault|pgsodium|supabase_\w+|cron|net|realtime)\s*\./;
// Tablas y vistas del catálogo sin esquema (pg_stat_activity, pg_authid, pg_roles…):
// search_path las resuelve a pg_catalog aunque no lleven prefijo.
const SYSTEM_RELATIONS = /\bpg_\w+\b(?!\s*\()/;

// Nada de lo que escribe, borra, cambia permisos o ejecuta código arbitrario.
const READ_FORBIDDEN =
  /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|lock|vacuum|analyze|refresh|reindex|cluster|comment|security|set|reset|listen|notify|unlisten|prepare|execute|deallocate|discard|into|import|load|checkpoint)\b/;
const READ_FORBIDDEN_FN =
  /\b(pg_terminate_backend|pg_cancel_backend|pg_sleep\w*|pg_read_\w+|pg_ls_\w+|pg_stat_file|lo_\w+|dblink\w*|set_config|nextval|setval|pg_advisory\w*|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_promote|pg_logical\w*|pg_replication\w*|query_to_xml\w*|xpath\w*|current_setting)\s*\(/;

export function checkReadQuery(sql: string): GuardResult {
  const parts = split(sql);
  if ("error" in parts) return { ok: false, reason: parts.error };
  if (parts.length !== 1) return { ok: false, reason: "Solo una consulta a la vez." };
  const [{ original, masked, idents }] = parts;
  if (!/^(select|with|explain|show)\b/.test(masked)) return { ok: false, reason: "Solo consultas de lectura (SELECT)." };
  const bad = masked.match(READ_FORBIDDEN) ?? idents.match(READ_FORBIDDEN_FN);
  if (bad) return { ok: false, reason: `No permitido en una lectura: ${bad[0].replace(/\s*\($/, "")}.` };
  if (SYSTEM_SCHEMAS.test(idents) || SYSTEM_RELATIONS.test(idents)) return { ok: false, reason: "No se leen esquemas del sistema." };
  return { ok: true, statements: [original] };
}

// Formas aditivas permitidas. Todo lo demás se rechaza.
const DDL_ALLOWED = [
  /^create\s+table\s+(if\s+not\s+exists\s+)?[\w."]+\s*\(/,
  /^create\s+(unique\s+)?index\s+(if\s+not\s+exists\s+)?[\w"]*\s*on\s+/,
  /^alter\s+table\s+(if\s+exists\s+)?(only\s+)?[\w."]+\s+add\s+/,
  /^alter\s+table\s+(if\s+exists\s+)?(only\s+)?[\w."]+\s+alter\s+(column\s+)?[\w"]+\s+set\s+(default\b|not\s+null\s*$)/,
  /^comment\s+on\s+(table|column|index)\s+/,
];

// Palabras que destruyen o tocan datos, o abren la puerta a hacerlo después
// (triggers, funciones, ON DELETE CASCADE, permisos, cambiar tipos).
const DDL_FORBIDDEN =
  /\b(drop|truncate|delete|update|insert|merge|copy|grant|revoke|rename|cascade|owner|function|procedure|trigger|rule|policy|execute|call|do|vacuum|cluster|reindex|security|concurrently|unlogged|temp|temporary|inherits|partition|attach|detach|disable|enable|replica|tablespace|select|lock|role|user|extension|schema|type|using|generated|identity|sequence|nextval|setval)\b/;

const MAX_DDL_STATEMENTS = 10;

/**
 * Lo único que se puede llamar dentro de un DEFAULT o un CHECK. Un DEFAULT volátil
 * corre una vez por fila existente al agregar la columna (también en la prueba que
 * se deshace), y una función del cliente puede tener efectos fuera de la transacción.
 * Por eso: lista de permitidos, no de prohibidos.
 */
const SAFE_CALLS = new Set([
  // Funciones puras o de fecha/identificador.
  "now", "gen_random_uuid", "uuid_generate_v4", "clock_timestamp", "statement_timestamp", "transaction_timestamp", "timezone",
  "lower", "upper", "length", "char_length", "character_length", "octet_length", "btrim", "ltrim", "rtrim", "trim",
  "coalesce", "nullif", "greatest", "least", "abs", "round", "floor", "ceil", "extract", "date_trunc",
  "array_length", "cardinality", "jsonb_typeof", "json_typeof", "jsonb_array_length", "to_jsonb",
  // Tipos con modificador (varchar(10), numeric(10,2)…) y palabras de la sintaxis.
  "varchar", "char", "character", "numeric", "decimal", "timestamp", "timestamptz", "time", "timetz", "interval", "bit", "varbit", "float",
  "in", "any", "all", "array", "and", "or", "not", "is", "between", "like", "ilike", "similar", "case", "when", "then", "else", "values",
]);

/** Las expresiones de cada DEFAULT y CHECK de una sentencia (sobre la versión con identificadores visibles). */
function expressions(stmt: string): string[] {
  const out: string[] = [];
  for (const m of stmt.matchAll(/\b(default|check)\b/g)) {
    let i = m.index + m[0].length;
    const isCheck = m[1] === "check";
    while (/\s/.test(stmt[i] ?? "")) i++;
    if (isCheck && stmt[i] !== "(") continue;
    let depth = 0;
    const start = i;
    for (; i < stmt.length; i++) {
      const c = stmt[i];
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) break;
        depth--;
        if (isCheck && depth === 0) {
          i++;
          break;
        }
      } else if (c === "," && depth === 0) break;
    }
    out.push(stmt.slice(start, i));
  }
  return out;
}

function unsafeCall(stmt: string): string | null {
  for (const expr of expressions(stmt)) {
    for (const call of expr.matchAll(/(::\s*)?\b([a-z_][\w$]*)(?:\s*\.\s*([a-z_][\w$]*))?\s*\(/g)) {
      if (call[1]) continue; // conversión de tipo: 'x'::varchar(10)
      const [schema, name] = call[3] ? [call[2], call[3]] : [null, call[2]];
      if (!SAFE_CALLS.has(name) || (schema && schema !== "extensions")) return call[0].replace(/\s*\($/, "");
    }
  }
  return null;
}

export function checkSchemaChange(sql: string): GuardResult {
  const parts = split(sql);
  if ("error" in parts) return { ok: false, reason: parts.error };
  if (parts.length === 0) return { ok: false, reason: "Cambio vacío." };
  if (parts.length > MAX_DDL_STATEMENTS) return { ok: false, reason: `Máximo ${MAX_DDL_STATEMENTS} sentencias.` };
  for (const { masked, idents } of parts) {
    if (!DDL_ALLOWED.some((re) => re.test(masked))) {
      return { ok: false, reason: `Solo se permite agregar estructura (CREATE TABLE/INDEX, ADD COLUMN/CONSTRAINT, SET DEFAULT, SET NOT NULL). Rechazado: "${masked.slice(0, 60)}…"` };
    }
    // Un DEFAULT o un CHECK corren en cada escritura de la app: tampoco llaman funciones peligrosas.
    const bad = masked.match(DDL_FORBIDDEN) ?? idents.match(READ_FORBIDDEN_FN);
    if (bad) return { ok: false, reason: `Palabra no permitida en un cambio de estructura: ${bad[0].replace(/\s*\($/, "")}.` };
    const call = unsafeCall(idents);
    if (call) return { ok: false, reason: `Función no permitida en un DEFAULT o CHECK: ${call}.` };
    if (SYSTEM_SCHEMAS.test(idents)) return { ok: false, reason: "No se modifican esquemas del sistema." };
  }
  return { ok: true, statements: parts.map((p) => p.original) };
}
