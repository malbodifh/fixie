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
export function mask(sql: string): { masked: string } | { error: string } {
  const out = sql.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
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
      blank(i + 1, j);
      i = j + 1;
    } else {
      i++;
    }
  }
  return { masked: out.join("") };
}

/** Separa sentencias por ';' (fuera de textos y comentarios). */
export function split(sql: string): { original: string; masked: string }[] | { error: string } {
  const m = mask(sql);
  if ("error" in m) return m;
  const parts: { original: string; masked: string }[] = [];
  let start = 0;
  for (let i = 0; i <= m.masked.length; i++) {
    if (i === m.masked.length || m.masked[i] === ";") {
      const masked = m.masked.slice(start, i);
      if (masked.trim()) parts.push({ original: sql.slice(start, i).trim(), masked: masked.trim().toLowerCase() });
      start = i + 1;
    }
  }
  return parts;
}

const SYSTEM_SCHEMAS = /\b(pg_catalog|information_schema|pg_toast|auth|storage|vault|pgsodium|supabase_\w+|cron|net|realtime)\s*\./;

// Nada de lo que escribe, borra, cambia permisos o ejecuta código arbitrario.
const READ_FORBIDDEN =
  /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|lock|vacuum|analyze|refresh|reindex|cluster|comment|security|set|reset|listen|notify|unlisten|prepare|execute|deallocate|discard|into|import|load|checkpoint)\b/;
const READ_FORBIDDEN_FN =
  /\b(pg_terminate_backend|pg_cancel_backend|pg_sleep\w*|pg_read_\w+|pg_ls_\w+|pg_stat_file|lo_\w+|dblink\w*|set_config|nextval|setval|pg_advisory\w*|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_promote|pg_logical\w*|pg_replication\w*|query_to_xml\w*|xpath\w*|current_setting)\s*\(/;

export function checkReadQuery(sql: string): GuardResult {
  const parts = split(sql);
  if ("error" in parts) return { ok: false, reason: parts.error };
  if (parts.length !== 1) return { ok: false, reason: "Solo una consulta a la vez." };
  const [{ original, masked }] = parts;
  if (!/^(select|with|explain|show)\b/.test(masked)) return { ok: false, reason: "Solo consultas de lectura (SELECT)." };
  const bad = masked.match(READ_FORBIDDEN) ?? masked.match(READ_FORBIDDEN_FN);
  if (bad) return { ok: false, reason: `No permitido en una lectura: ${bad[0].replace(/\s*\($/, "")}.` };
  if (SYSTEM_SCHEMAS.test(masked)) return { ok: false, reason: "No se leen esquemas del sistema." };
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

export function checkSchemaChange(sql: string): GuardResult {
  const parts = split(sql);
  if ("error" in parts) return { ok: false, reason: parts.error };
  if (parts.length === 0) return { ok: false, reason: "Cambio vacío." };
  if (parts.length > MAX_DDL_STATEMENTS) return { ok: false, reason: `Máximo ${MAX_DDL_STATEMENTS} sentencias.` };
  for (const { masked } of parts) {
    if (!DDL_ALLOWED.some((re) => re.test(masked))) {
      return { ok: false, reason: `Solo se permite agregar estructura (CREATE TABLE/INDEX, ADD COLUMN/CONSTRAINT, SET DEFAULT, SET NOT NULL). Rechazado: "${masked.slice(0, 60)}…"` };
    }
    const bad = masked.match(DDL_FORBIDDEN);
    if (bad) return { ok: false, reason: `Palabra no permitida en un cambio de estructura: ${bad[0]}.` };
    if (SYSTEM_SCHEMAS.test(masked)) return { ok: false, reason: "No se modifican esquemas del sistema." };
  }
  return { ok: true, statements: parts.map((p) => p.original) };
}
