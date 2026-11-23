import "server-only";
import { startRepair } from "./agent/advance";
import { hasModelKey } from "./agent/model";
import type { ProjectRow } from "./db";
import { createRepair, listRepairs } from "./incidents";
import type { RepairInfo, RepairSummary } from "./model";
import { projectContext } from "./projects";
import { latestScans, type ScanRow } from "./scans";
import { NEEDS_DECISION, repairable, type Finding, type ScanKind } from "./scans/common";
import { coversKnownVulns } from "./plans";
import { checkAllowance, isCriticalWork, planOf } from "./usage";

/**
 * Una reparación de código a la vez por proyecto (varias tocarían los mismos
 * archivos, como next.config). Orden: lo que rompe la app primero. Las
 * dependencias van aparte: solo tocan package.json y el lockfile.
 */
const PRIORITY: ScanKind[] = ["errors", "pentest_deep", "pentest", "lighthouse"];

/** La revisión es diaria: un intento por día, aunque el cron se corra unos minutos antes. */
const RETRY_AFTER_MS = 20 * 60 * 60_000;
/**
 * Tras 3 intentos fallidos seguidos que ya cubrían todos estos hallazgos, se
 * espera una semana. (El panel todavía no muestra esta espera.)
 */
const MAX_FAILED_ATTEMPTS = 3;
const BACKOFF_MS = 7 * 24 * 60 * 60_000;

/** Carril de la reparación: el código (una a la vez) o las dependencias (aparte). */
const laneOf = (project: ProjectRow, kind: ScanKind) => `${project.id}:${kind === "deps" ? "deps" : "code"}`;
const busy = (all: RepairSummary[], kind: ScanKind) => all.some((r) => r.open && (kind === "deps") === (r.kind === "deps"));
// Entre leer las reparaciones abiertas y crear el issue pasan varios segundos: dos
// llamadas a la vez en esta instancia (cron, panel, asistente) abrirían dos.
const opening = new Set<string>();

function infoFor(scan: ScanRow, findings: Finding[]): RepairInfo {
  return {
    kind: scan.kind,
    scanId: scan.id,
    scoreBefore: scan.score,
    findings: findings.map((f) => ({ id: f.id, title: f.title, severity: f.severity, detail: f.detail, fix: f.fix, pkg: f.pkg, copy: f.copy })),
  };
}

/** ¿Toca reintentar estos hallazgos ahora? Una vez al día; pausa tras varios fallos seguidos. */
export function shouldRetry(repairs: RepairSummary[], ids: string[], now = Date.now()): boolean {
  const same = repairs.filter((r) => ids.every((id) => r.findingIds.includes(id)));
  const last = same[0];
  if (!last) return true;
  const age = now - Date.parse(last.createdAt);
  let failedInRow = 0;
  for (const r of same) {
    if (r.outcome !== "not_planned") break;
    failedInRow++;
  }
  if (failedInRow >= MAX_FAILED_ATTEMPTS) return age >= BACKOFF_MS;
  return age >= RETRY_AFTER_MS;
}

/**
 * Tras cada análisis, Fixie repara solo lo que no necesita una decisión:
 * abre una reparación (issue + PR en el entorno de pruebas) con los hallazgos
 * que se arreglan con código. Conversión espera a que el usuario elija.
 * Devuelve el trabajo de fondo, o null si no hay nada que hacer hoy.
 */
export async function startRepairIfNeeded(project: ProjectRow, scan: ScanRow): Promise<(() => Promise<void>) | null> {
  if (scan.status !== "ok" || NEEDS_DECISION.includes(scan.kind)) return null;
  const findings = repairable(scan.findings);
  if (findings.length === 0) return null;
  // Las dependencias se actualizan sin IA; lo demás necesita el modelo.
  if (scan.kind !== "deps" && !hasModelKey()) return null;
  // La vigilancia de vulnerabilidades conocidas es de los planes de pago.
  if (scan.kind === "deps" && !coversKnownVulns(await planOf(project.owner_id))) return null;

  const lane = laneOf(project, scan.kind);
  if (opening.has(lane)) return null;
  opening.add(lane);
  try {
    const ctx = await projectContext(project);
    const all = await listRepairs(ctx.repo);
    if (busy(all, scan.kind)) return null;
    const repairs = all.filter((r) => r.kind === scan.kind);
    if (!shouldRetry(repairs, findings.map((f) => f.id))) return null;

    const info = infoFor(scan, findings);
    // Sin créditos no se abre: la revisión diaria lo vuelve a intentar cuando se renueven.
    if (scan.kind !== "deps" && !(await checkAllowance(project.owner_id, isCriticalWork(info))).ok) return null;
    const issue = await createRepair(ctx.repo, info);
    return startRepair(ctx, issue.number, info);
  } finally {
    opening.delete(lane);
  }
}

/**
 * La siguiente reparación pendiente según la prioridad, con los últimos
 * análisis. Se llama tras la revisión diaria y cuando una reparación termina,
 * para que todo lo del día quede reparado aunque sea de madrugada.
 */
export async function startNextRepair(project: ProjectRow): Promise<(() => Promise<void>) | null> {
  const scans = await latestScans(project.id);
  for (const kind of PRIORITY) {
    const scan = scans[kind];
    if (!scan) continue;
    const job = await startRepairIfNeeded(project, scan);
    if (job) return job;
  }
  return null;
}

/** El usuario eligió qué aplicar (Conversión): se repara exactamente eso. */
export async function startChosenRepair(project: ProjectRow, scan: ScanRow, ids: string[]): Promise<(() => Promise<void>) | { error: string }> {
  const findings = scan.findings.filter((f) => ids.includes(f.id) && !f.passed && !f.manual);
  if (findings.length === 0) return { error: "Elige al menos un cambio." };
  const inProgress = { error: "Ya hay cambios en curso. Espera a que terminen." };
  const lane = laneOf(project, scan.kind);
  if (opening.has(lane)) return inProgress;
  opening.add(lane);
  try {
    const ctx = await projectContext(project);
    // Una reparación de código a la vez por proyecto, también para lo que elige el usuario.
    if (busy(await listRepairs(ctx.repo), scan.kind)) return inProgress;
    const info = infoFor(scan, findings);
    // Los textos elegidos se aplican sin IA; lo demás necesita créditos.
    if (findings.some((f) => !f.copy)) {
      const ok = await checkAllowance(project.owner_id, false);
      if (!ok.ok) return { error: "Llegaste al límite de consumo de tu plan. Puedes aplicar solo los cambios de texto o esperar a que se renueven tus créditos." };
    }
    const issue = await createRepair(ctx.repo, info);
    return startRepair(ctx, issue.number, info);
  } finally {
    opening.delete(lane);
  }
}
