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

/** -1, 0 o 1. Las versiones inválidas se ordenan al principio. */
export function cmp(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
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

/** ¿`version` cumple el rango de npm? Soporta exacto, ^, ~, >, >=, <, <=, x/*, || y rangos con guion. Ante la duda, false. */
export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  if (!v) return false;
  return range.split("||").some((part) => {
    const p = part.trim();
    if (p === "" || p === "*" || p === "x" || p === "latest") return v.pre.length === 0;
    const hyphen = p.match(/^(\S+)\s+-\s+(\S+)$/);
    if (hyphen) return cmp(version, hyphen[1]) >= 0 && cmp(version, hyphen[2]) <= 0;
    return p.split(/\s+/).every((c) => comparator(version, v, c));
  });
}

function comparator(version: string, v: Parsed, c: string): boolean {
  const m = c.match(/^(\^|~|>=|<=|>|<|=)?v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(-[0-9A-Za-z.-]+)?$/);
  if (!m) return false;
  const op = m[1] ?? "";
  const nums = [m[2], m[3], m[4]].map((n) => (n === undefined || n === "x" || n === "*" ? null : Number(n)));
  const base = `${nums[0] ?? 0}.${nums[1] ?? 0}.${nums[2] ?? 0}${m[5] ?? ""}`;
  // Prereleases solo cuentan si el rango apunta a la misma versión base con prerelease.
  if (v.pre.length && !(m[5] && v.nums.join(".") === `${nums[0]}.${nums[1]}.${nums[2]}`)) return false;
  const [M, mi, pa] = nums;
  if (op === "" || op === "=") {
    if (M === null) return true;
    if (mi === null) return v.nums[0] === M;
    if (pa === null) return v.nums[0] === M && v.nums[1] === mi;
    return cmp(version, base) === 0;
  }
  if (op === ">=") return cmp(version, base) >= 0;
  if (op === ">") return cmp(version, base) > 0;
  if (op === "<=") return cmp(version, base) <= 0;
  if (op === "<") return cmp(version, base) < 0;
  if (op === "~") {
    const upper = mi === null ? `${M! + 1}.0.0` : `${M}.${mi + 1}.0`;
    return cmp(version, base) >= 0 && cmp(version, `${upper}-0`) < 0;
  }
  // ^: no cambia el primer número distinto de cero.
  const upper = M! > 0 || mi === null ? `${M! + 1}.0.0` : mi > 0 || pa === null ? `0.${mi + 1}.0` : `0.0.${pa + 1}`;
  return cmp(version, base) >= 0 && cmp(version, `${upper}-0`) < 0;
}

/** Mismo "carril" de compatibilidad: igual mayor (o igual menor si la mayor es 0). */
export function sameLine(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  return x.nums[0] === y.nums[0] && (x.nums[0] !== 0 || x.nums[1] === y.nums[1]);
}
