import "server-only";
import type { Repo } from "../github";
import { cmp, isVersion } from "../semver";
import { scoreOf, summaryOf, type Finding, type ScanResult, type Severity } from "./common";

/**
 * Vigilancia de dependencias: las versiones EXACTAS del package-lock.json del
 * repo contra las vulnerabilidades publicadas (OSV, que incluye GitHub
 * Advisories). Las que CISA lista como explotadas activamente suben a crítico.
 * Solo lee el repo y bases públicas.
 */

export type Installed = { name: string; version: string; path: string; direct: boolean; requiredBy: string[] };

type OsvEvent = { introduced?: string; fixed?: string; last_affected?: string };
type OsvVuln = {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  affected?: { package?: { name?: string; ecosystem?: string }; ranges?: { type: string; events: OsvEvent[] }[]; versions?: string[] }[];
};

const OSV = "https://api.osv.dev/v1";
const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

/** Lee un package-lock (v1, v2 o v3) y devuelve cada paquete instalado con su ruta. */
export function parseLockfile(lockText: string, pkgText: string | null): Installed[] {
  const lock = JSON.parse(lockText) as {
    packages?: Record<string, { version?: string; link?: boolean; name?: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>;
    dependencies?: Record<string, { version: string; dependencies?: Record<string, unknown> }>;
  };
  const pkg = pkgText ? (JSON.parse(pkgText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }) : {};
  const directNames = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  const out: Installed[] = [];

  if (lock.packages) {
    // Quién pide cada paquete, para explicar de dónde viene una dependencia indirecta.
    const requiredBy = new Map<string, Set<string>>();
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path) continue;
      const owner = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      for (const dep of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
        if (!requiredBy.has(dep)) requiredBy.set(dep, new Set());
        requiredBy.get(dep)!.add(owner);
      }
    }
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path || entry.link || !entry.version || !isVersion(entry.version)) continue;
      const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      out.push({ name, version: entry.version, path, direct: path === `node_modules/${name}` && directNames.has(name), requiredBy: [...(requiredBy.get(name) ?? [])] });
    }
    return out;
  }

  // lockfileVersion 1: árbol anidado de "dependencies".
  const walk = (deps: Record<string, { version: string; dependencies?: Record<string, unknown> }>, prefix: string) => {
    for (const [name, entry] of Object.entries(deps)) {
      const path = `${prefix}node_modules/${name}`;
      if (isVersion(entry.version)) out.push({ name, version: entry.version, path, direct: !prefix && directNames.has(name), requiredBy: [] });
      if (entry.dependencies) walk(entry.dependencies as Record<string, { version: string }>, `${path}/`);
    }
  };
  walk(lock.dependencies ?? {}, "");
  return out;
}

// ── Fuentes públicas, con caché en memoria ─────────────────────

const vulnCache = new Map<string, { at: number; vuln: OsvVuln }>();
let kevCache: { at: number; ids: Set<string> } | null = null;

async function osvVuln(id: string): Promise<OsvVuln> {
  const hit = vulnCache.get(id);
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.vuln;
  const res = await fetch(`${OSV}/vulns/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`OSV respondió ${res.status}`);
  const vuln = (await res.json()) as OsvVuln;
  vulnCache.set(id, { at: Date.now(), vuln });
  return vuln;
}

/** Catálogo de CISA de vulnerabilidades explotadas activamente (se actualiza cada 6 h). */
async function exploitedCves(): Promise<Set<string>> {
  if (kevCache && Date.now() - kevCache.at < 6 * 60 * 60_000) return kevCache.ids;
  try {
    const res = await fetch(KEV_URL, { signal: AbortSignal.timeout(15_000) });
    const json = (await res.json()) as { vulnerabilities?: { cveID: string }[] };
    kevCache = { at: Date.now(), ids: new Set((json.vulnerabilities ?? []).map((v) => v.cveID)) };
  } catch {
    kevCache = { at: Date.now(), ids: kevCache?.ids ?? new Set() };
  }
  return kevCache.ids;
}

async function osvBatch(list: { name: string; version: string }[]): Promise<string[][]> {
  const out: string[][] = [];
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const res = await fetch(`${OSV}/querybatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries: chunk.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version })) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`OSV respondió ${res.status}`);
    const json = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
    for (const r of json.results) out.push((r.vulns ?? []).map((v) => v.id));
  }
  return out;
}

/** La primera versión corregida para la versión instalada, o null si todavía no hay parche. */
export function fixedVersion(vuln: OsvVuln, name: string, version: string): string | null {
  let best: string | null = null;
  for (const a of vuln.affected ?? []) {
    if (a.package?.name !== name || (a.package.ecosystem && a.package.ecosystem !== "npm")) continue;
    for (const r of a.ranges ?? []) {
      if (r.type !== "SEMVER" && r.type !== "ECOSYSTEM") continue;
      let introduced: string | null = null;
      for (const e of r.events) {
        if (e.introduced !== undefined) introduced = e.introduced;
        if (e.fixed !== undefined && introduced !== null) {
          const inRange = (introduced === "0" || cmp(version, introduced) >= 0) && cmp(version, e.fixed) < 0;
          if (inRange && (!best || cmp(e.fixed, best) < 0)) best = e.fixed;
          introduced = null;
        }
      }
    }
  }
  return best;
}

const SEVERITY: Record<string, Severity> = { CRITICAL: "critico", HIGH: "alto", MODERATE: "medio", MEDIUM: "medio", LOW: "bajo" };

export async function runDeps(repo: Repo): Promise<ScanResult> {
  const head = await repo.getDefaultBranchHead();
  const lockText = await repo.readFile("package-lock.json", head.sha).catch(() => null);
  if (!lockText) {
    return { status: "error", score: null, summary: "No encontré package-lock.json en la rama principal. Por ahora Fixie vigila proyectos con npm.", findings: [] };
  }
  const pkgText = await repo.readFile("package.json", head.sha).catch(() => null);
  const installed = parseLockfile(lockText, pkgText);

  // Una consulta por par nombre@versión (el mismo paquete puede estar en varias rutas).
  const unique = [...new Map(installed.map((p) => [`${p.name}@${p.version}`, p])).values()];
  const [hits, kev] = await Promise.all([osvBatch(unique), exploitedCves()]);

  const findings: Finding[] = [];
  for (let i = 0; i < unique.length; i++) {
    const { name, version } = unique[i];
    for (const id of hits[i]) {
      const vuln = await osvVuln(id).catch(() => null);
      if (!vuln) continue;
      const fixed = fixedVersion(vuln, name, version);
      const cves = (vuln.aliases ?? []).filter((a) => a.startsWith("CVE-"));
      const exploited = cves.some((c) => kev.has(c));
      const where = installed.filter((p) => p.name === name && p.version === version);
      const direct = where.some((p) => p.direct);
      findings.push({
        id: `dep:${name}:${vuln.id}`,
        title: `${name} ${version}: ${vuln.summary ?? vuln.id}`,
        severity: exploited ? "critico" : (SEVERITY[(vuln.database_specific?.severity ?? "").toUpperCase()] ?? "medio"),
        passed: false,
        detail: [
          exploited ? "Explotada activamente (catálogo de CISA)." : null,
          [vuln.id, ...cves].join(" · "),
          direct ? "Dependencia directa." : `Dependencia indirecta${where[0]?.requiredBy.length ? `: la trae ${where[0].requiredBy.slice(0, 3).join(", ")}` : ""}.`,
          fixed ? `Corregida en ${fixed}.` : "Todavía no hay versión corregida: Fixie actualiza en cuanto se publique.",
        ]
          .filter(Boolean)
          .join(" "),
        fix: fixed ? `Actualizar \`${name}\` de ${version} a ${fixed}.` : undefined,
        manual: !fixed,
        pkg: fixed ? { name, from: version, to: fixed } : undefined,
      });
    }
  }

  const vulnerable = new Set(findings.map((f) => f.id.split(":")[1]));
  findings.push({
    id: "deps-watch",
    title: `${unique.length} paquetes vigilados`,
    severity: "info",
    passed: vulnerable.size === 0,
    detail: vulnerable.size ? `${vulnerable.size} con vulnerabilidades conocidas.` : "Ninguno con vulnerabilidades conocidas.",
  });

  return {
    status: "ok",
    score: scoreOf(findings),
    summary: findings.some((f) => !f.passed && f.severity !== "info") ? summaryOf(findings) : "Sin vulnerabilidades conocidas.",
    findings,
    meta: { packages: unique.length, direct: installed.filter((p) => p.direct).length, commit: head.sha },
  };
}
