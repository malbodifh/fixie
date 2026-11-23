// Comparación de versiones semver (lo justo para lockfiles de npm), sin dependencias.

type Parsed = { nums: [number, number, number]; pre: string[] };

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function isVersion(v: string): boolean {
  return SEMVER.test(v);
}

function parse(v: string): Parsed | null {
  const m = v.trim().match(SEMVER);
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] } : null;
}

function compare(x: Parsed, y: Parsed): number {
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  // Una versión sin prerelease es mayor que la misma con prerelease.
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** -1, 0 o 1. Las versiones inválidas se ordenan al principio. */
export function cmp(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  return compare(x, y);
}

// ── Rangos ────────────────────────────────────────────────────
// Como node-semver: cada rango se traduce a comparadores simples (>=, >, <, <=, =)
// y "-0" marca el límite superior exclusivo (por debajo de cualquier prerelease).

type Op = ">=" | ">" | "<" | "<=" | "=";
type Comparator = { op: Op; v: Parsed };
type Partial = { nums: (number | null)[]; pre: string };

const ANY: Comparator[] = [];

function at(op: Op, M: number, mi: number, pa: number, pre = ""): Comparator {
  return { op, v: { nums: [M, mi, pa], pre: pre ? pre.split(".") : [] } };
}

const NONE: Comparator[] = [at("<", 0, 0, 0, "0")];

/** "1", "1.2", "1.x", "*", "1.2.3-beta"… Tras un comodín, el resto también lo es. */
function partial(s: string): Partial | null {
  const m = s.match(/^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  let wild = false;
  const nums = [m[1], m[2], m[3]].map((n) => {
    wild ||= n === undefined || /^[xX*]$/.test(n);
    return wild ? null : Number(n);
  });
  return { nums, pre: wild ? "" : (m[4] ?? "") };
}

function desugar(op: string, { nums: [M, mi, pa], pre }: Partial): Comparator[] {
  if (M === null) return op === ">" || op === "<" ? NONE : ANY;
  switch (op) {
    case "":
    case "=":
      if (mi === null) return [at(">=", M, 0, 0), at("<", M + 1, 0, 0, "0")];
      if (pa === null) return [at(">=", M, mi, 0), at("<", M, mi + 1, 0, "0")];
      return [at("=", M, mi, pa, pre)];
    case ">":
      if (mi === null) return [at(">=", M + 1, 0, 0)];
      if (pa === null) return [at(">=", M, mi + 1, 0)];
      return [at(">", M, mi, pa, pre)];
    case ">=":
      return [at(">=", M, mi ?? 0, pa ?? 0, pre)];
    case "<":
      if (pa === null) return [at("<", M, mi ?? 0, 0, "0")];
      return [at("<", M, mi!, pa, pre)];
    case "<=":
      if (mi === null) return [at("<", M + 1, 0, 0, "0")];
      if (pa === null) return [at("<", M, mi + 1, 0, "0")];
      return [at("<=", M, mi, pa, pre)];
    case "~":
    case "~>":
      if (mi === null) return [at(">=", M, 0, 0), at("<", M + 1, 0, 0, "0")];
      return [at(">=", M, mi, pa ?? 0, pre), at("<", M, mi + 1, 0, "0")];
    default: {
      // ^: no cambia el primer número distinto de cero.
      if (mi === null) return [at(">=", M, 0, 0), at("<", M + 1, 0, 0, "0")];
      const low = at(">=", M, mi, pa ?? 0, pre);
      if (M > 0) return [low, at("<", M + 1, 0, 0, "0")];
      if (mi > 0 || pa === null) return [low, at("<", 0, mi + 1, 0, "0")];
      return [low, at("<", 0, 0, pa + 1, "0")];
    }
  }
}

/** Un tramo de un rango (sin ||) como lista de comparadores, o null si no se entiende. */
function comparators(part: string): Comparator[] | null {
  // ">= 1.2.3" equivale a ">=1.2.3".
  const p = part.trim().replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, "$1");
  if (p === "" || p === "latest") return ANY;
  const hyphen = p.match(/^(\S+)\s+-\s+(\S+)$/);
  if (hyphen) {
    const lo = partial(hyphen[1]);
    const hi = partial(hyphen[2]);
    return lo && hi ? [...desugar(">=", lo), ...desugar("<=", hi)] : null;
  }
  const out: Comparator[] = [];
  for (const token of p.split(/\s+/)) {
    const m = token.match(/^(\^|~>?|>=|<=|>|<|=)?(.*)$/)!;
    const parsed = partial(m[2]);
    if (!parsed) return null;
    out.push(...desugar(m[1] ?? "", parsed));
  }
  return out;
}

function test(v: Parsed, c: Comparator): boolean {
  const d = compare(v, c.v);
  return c.op === "=" ? d === 0 : c.op === ">=" ? d >= 0 : c.op === ">" ? d > 0 : c.op === "<" ? d < 0 : d <= 0;
}

/**
 * ¿`version` cumple el rango de npm? Soporta exacto, ^, ~, >, >=, <, <=, x/*,
 * versiones parciales, || y rangos con guion. Una prerelease solo cumple si algún
 * comparador del mismo tramo tiene prerelease en la misma versión base. Ante la duda, false.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  if (!v) return false;
  return range.split("||").some((part) => {
    const set = comparators(part);
    if (!set || !set.every((c) => test(v, c))) return false;
    if (!v.pre.length) return true;
    return set.some((c) => c.v.pre.length > 0 && c.v.nums.every((n, i) => n === v.nums[i]));
  });
}

/** Mismo "carril" de compatibilidad: igual mayor (o igual menor si la mayor es 0). */
export function sameLine(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  return x.nums[0] === y.nums[0] && (x.nums[0] !== 0 || x.nums[1] === y.nums[1]);
}
