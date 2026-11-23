import "server-only";
import { applySchemaChange } from "../clientdb";
import { GitHubError, type CiState } from "../github";
import { markAgentFailed, postStep, type Incident, type RepairInfo, type Step } from "../incidents";
import { currentAttempt, DEPLOY_TIMEOUT_MS, lastProgress, MAX_ROUNDS, REPAIR_LABEL, type PausedStage, type StepData, type StepKind } from "../model";
import { createBackup, getPendingDbChange, setDbChangeStatus, type ProjectContext } from "../projects";
import { runScan } from "../scans";
import { BudgetExceededError, checkAllowance, isCriticalWork } from "../usage";
import { applyCopyAndOpenPR } from "./copy";
import { updateDepsAndOpenPR } from "./deps";
import { retryFix, diagnoseAndOpenPR } from "./fix";
import { repairAndOpenPR } from "./repair";
import { reviewFix } from "./review";

/** Si CI no reporta nada en este tiempo, se pide revisión humana. */
const NO_CI_TIMEOUT_MS = 4 * 60_000;
/** Si CI reporta pero no termina en este tiempo (runner atascado o en cola), se pide revisión humana. */
const CI_TIMEOUT_MS = 60 * 60_000;
/**
 * Un agente en segundo plano que no termina en este tiempo se da por caído.
 * Debe superar el maxDuration (300 s) de las rutas que corren a los agentes.
 */
const AGENT_TIMEOUT_MS = 8 * 60_000;

// Evita que dos consultas simultáneas avancen el mismo incidente en esta instancia.
const advancing = new Set<string>();
// Una pausa se retoma una sola vez aunque lleguen varias consultas a la vez: se libera al terminar el trabajo.
const resuming = new Set<string>();

export type Advance = { changed: boolean; background?: () => Promise<void> };
const idle: Advance = { changed: false };

const findLast = (steps: Step[], pred: (s: Step) => boolean) => steps.findLast(pred);
const older = (iso: string, ms: number) => Date.now() - Date.parse(iso) > ms;
/** Momento desde el que se mide el tiempo de un agente: su inicio o la última reanudación tras una pausa. */
const since = (steps: Step[], at: string) => {
  const resumed = findLast(steps, (s) => s.kind === "resumed")?.at;
  return resumed && resumed > at ? resumed : at;
};
/** Commit completo o abreviado; cualquier otra cosa que devuelva /api/version no se compara. */
const SHA = /^[0-9a-f]{7,40}$/i;

/** Sin créditos: el trabajo queda en pausa (no fallido) y se retoma solo cuando se renuevan. */
async function pause(ctx: ProjectContext, issue: number, err: BudgetExceededError, data: StepData & { stage: PausedStage }) {
  await postStep(ctx.repo, issue, "paused", err.message, { ...data, resumeAt: new Date(err.resumeAt).toISOString() }).catch(() => {});
}

/** Corre un agente en segundo plano; si falla, el incidente queda para un humano. */
function guarded(ctx: ProjectContext, inc: Incident, what: string, fn: () => Promise<void>, resume: StepData & { stage: PausedStage }) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      if (err instanceof BudgetExceededError) return pause(ctx, inc.number, err, { pr: inc.pr ?? undefined, ...resume });
      console.error(`[fixie] ${what} falló`, err);
      const msg = err instanceof Error ? err.message : String(err);
      await postStep(ctx.repo, inc.number, "needs_review", `${what} falló: ${msg.slice(0, 300)}. Un humano debe revisar el PR.`, { pr: inc.pr ?? undefined }).catch(() => {});
    }
  };
}

/** Una reparación que no llegó a abrir su PR: se cierra y la revisión diaria la reintenta. */
async function failRepair(ctx: ProjectContext, issue: number, text: string) {
  await postStep(ctx.repo, issue, "failed", `${text}\n\nLa revisión de esta noche lo vuelve a intentar.`).catch(() => {});
  await ctx.repo.closeIssue(issue).catch(() => {});
}

/** Primer paso tras la ingesta: diagnóstico y PR del entorno de pruebas. */
export function startAgent(ctx: ProjectContext, issue: number, payload: NonNullable<Incident["payload"]>) {
  return async () => {
    try {
      await diagnoseAndOpenPR(ctx, issue, payload);
    } catch (err) {
      if (err instanceof BudgetExceededError) return pause(ctx, issue, err, { stage: "diagnose" });
      console.error("[fixie] el agente falló", err);
      const msg = err instanceof Error ? err.message : "El agente falló antes de terminar.";
      await markAgentFailed(ctx.repo, issue, msg.slice(0, 400)).catch(() => {});
    }
  };
}

/** Primer paso de una reparación de hallazgos: pruebas que los reproducen, reparación y PR. */
export function startRepair(ctx: ProjectContext, issue: number, info: RepairInfo) {
  return async () => {
    try {
      // Sin IA cuando se puede: dependencias con datos del registro y textos
      // elegidos con un reemplazo literal. El resto, el agente.
      if (info.kind === "deps") await updateDepsAndOpenPR(ctx, issue, info);
      else if (info.kind === "conversion" && (await applyCopyAndOpenPR(ctx, issue, info))) return;
      else await repairAndOpenPR(ctx, issue, info);
    } catch (err) {
      if (err instanceof BudgetExceededError) return pause(ctx, issue, err, { stage: "repair" });
      console.error("[fixie] la reparación falló", err);
      // Sin códigos de color de terminal: el mensaje se muestra en el panel.
      const msg = (err instanceof Error ? err.message : "El agente falló antes de terminar.").replace(/\u001b\[[0-9;]*m/g, "").trim();
      await failRepair(ctx, issue, msg.slice(0, 400));
    }
  };
}

/**
 * Máquina de estados del entorno de pruebas. La empujan el motor del servidor
 * y el panel: cada paso corre en una invocación corta y los agentes largos van
 * en segundo plano (after()). Orden:
 *   reproducir → arreglar → revisor intenta romperlo → (repetir) → BD → merge → verificar
 */
export async function advanceIncident(ctx: ProjectContext, inc: Incident): Promise<Advance> {
  const lock = `${ctx.project.id}:${inc.number}`;
  if (advancing.has(lock)) return idle;
  const paused = lastProgress(inc.steps);
  if (paused?.kind === "paused") {
    if (resuming.has(lock)) return idle;
    resuming.add(lock);
    const step = await resume(ctx, inc, paused.data).catch(() => idle);
    if (!step.background) {
      resuming.delete(lock);
      return step;
    }
    const job = step.background;
    return { ...step, background: () => job().finally(() => resuming.delete(lock)) };
  }
  const steps = currentAttempt(inc.steps);
  const has = (k: StepKind) => steps.some((s) => s.kind === k);
  if (has("verified") || has("failed") || has("needs_review") || has("not_reproduced")) return idle;

  advancing.add(lock);
  try {
    if (!inc.pr) return await stalled(ctx, inc, steps);
    return await advanceWithPR(ctx, inc, inc.pr, steps, has);
  } finally {
    advancing.delete(lock);
  }
}

/**
 * Sin PR todavía: el agente diagnostica en segundo plano. Si la función se
 * cortó a medias (sin pasos nuevos en AGENT_TIMEOUT_MS), el issue no queda
 * abierto para siempre ni bloquea las demás reparaciones del proyecto.
 */
async function stalled(ctx: ProjectContext, inc: Incident, steps: Step[]): Promise<Advance> {
  const last = lastProgress(steps);
  if (!last || !older(last.at, AGENT_TIMEOUT_MS)) return idle;
  const text = "El agente se detuvo antes de abrir el PR.";
  if (inc.repair) await failRepair(ctx, inc.number, text);
  else await markAgentFailed(ctx.repo, inc.number, text);
  return { changed: true };
}

async function advanceWithPR(ctx: ProjectContext, inc: Incident, prNumber: number, steps: Step[], has: (k: StepKind) => boolean): Promise<Advance> {
  const { repo, project } = ctx;
  const round = inc.round;
  const post = (kind: StepKind, text: string, data: StepData = {}) => postStep(repo, inc.number, kind, text, { pr: prNumber, round, ...data });
  const human = async (text: string): Promise<Advance> => {
    await post("needs_review", text);
    return { changed: true };
  };
  /** CI todavía sin veredicto: se espera, con límite. */
  const waitCi = (state: CiState, from: string): Promise<Advance> | Advance => {
    if (state === "none") return older(from, NO_CI_TIMEOUT_MS) ? human("CI no reportó resultados. El PR espera revisión humana.") : idle;
    return older(from, CI_TIMEOUT_MS) ? human("CI no terminó en una hora. El PR espera revisión humana.") : idle;
  };

  // ── Ya mergeado: verificar en producción ──
  const merged = findLast(steps, (s) => s.kind === "merged");
  if (merged) return verify(ctx, inc, merged.at);

  const pr = await repo.getPullRequest(prNumber);
  if (pr.merged && pr.merge_commit_sha) {
    await post("merged", `PR #${pr.number} mergeado. Desplegando a producción…`, { sha: pr.merge_commit_sha });
    return { changed: true };
  }
  if (pr.state === "closed") return human("El PR se cerró sin mergear.");

  const opened = findLast(steps, (s) => s.kind === "pr_opened")!;

  // ── 1. Reproducir: la prueba sola debe fallar ──
  if (!has("reproduced")) {
    const ci = await repo.getCiState(opened.data.sha!);
    if (ci.state === "pending" || ci.state === "none") return waitCi(ci.state, opened.at);
    if (ci.state === "success") {
      await post("not_reproduced", "La prueba pasó SIN el arreglo: no reproduce el error. No confío en este arreglo; un humano debe revisarlo.");
      return { changed: true };
    }
    try {
      await repo.moveBranch(pr.head.ref, opened.data.fixSha!);
    } catch (err) {
      // 422: la rama ya no avanza en línea recta hasta el arreglo (alguien empujó otros commits).
      if (err instanceof GitHubError && err.status === 422) return human("La rama del PR cambió fuera de Fixie y no puedo aplicar el arreglo. El PR espera revisión humana.");
      throw err;
    }
    await post("reproduced", "Reproducido: la prueba falla sin el arreglo, igual que en producción. Aplicando el arreglo…", { sha: opened.data.sha });
    return { changed: true };
  }

  // ── 2. El arreglo vigente debe pasar CI ──
  const lastFixing = findLast(steps, (s) => s.kind === "fixing");
  const lastPushed = findLast(steps, (s) => s.kind === "fix_pushed");
  if (lastFixing && (lastFixing.data.round ?? 1) > (lastPushed?.data.round ?? 1)) {
    return older(since(steps, lastFixing.at), AGENT_TIMEOUT_MS) ? human("El agente no terminó la nueva ronda a tiempo.") : idle;
  }
  const fixSha = lastPushed?.data.fixSha ?? opened.data.fixSha!;
  const startReview = async (): Promise<Advance> => {
    await post("review_started", "Otro agente revisa el arreglo e intenta volver a romperlo…", { sha: fixSha });
    return { changed: true, background: guarded(ctx, inc, "El revisor", () => reviewFix(ctx, inc, fixSha, round), { stage: "review", fixSha, round }) };
  };

  const fixVerdict = steps.find((s) => (s.kind === "ci_passed" || s.kind === "ci_failed") && s.data.sha === fixSha);
  if (!fixVerdict) {
    const ci = await repo.getCiState(fixSha);
    if (ci.state === "pending" || ci.state === "none") return waitCi(ci.state, (lastPushed ?? opened).at);
    if (ci.state === "failure") {
      await post("ci_failed", `Con el arreglo, CI todavía falla (${ci.failed.join(", ")}).`, { sha: fixSha });
      return nextRound(ctx, inc, round, `CI falló con el arreglo:\n${ci.details}`, post, human);
    }
    await post("ci_passed", round === 1 ? "Con el arreglo, las pruebas pasan." : "Todas las pruebas pasan, incluidas las del revisor.", { sha: fixSha });
    return startReview();
  }
  if (fixVerdict.kind === "ci_failed") {
    // Llegar aquí significa que el paso "fixing" de la ronda siguiente no se publicó
    // (si no, se habría devuelto arriba): se reanuda en vez de quedarse esperando para siempre.
    const ci = await repo.getCiState(fixSha);
    return nextRound(ctx, inc, round, `CI falló con el arreglo:\n${ci.details}`, post, human);
  }

  // ── 3. El revisor intenta romperlo ──
  const reviewStarted = findLast(steps, (s) => s.kind === "review_started" && s.data.sha === fixSha);
  if (!reviewStarted) return startReview();
  const reviewPushed = steps.find((s) => s.kind === "review_pushed" && s.data.sha === fixSha);
  if (!reviewPushed) return older(since(steps, reviewStarted.at), AGENT_TIMEOUT_MS) ? human("El revisor no terminó a tiempo.") : idle;

  const reviewSha = reviewPushed.data.reviewSha!;
  const reviewVerdict = steps.find((s) => (s.kind === "review_passed" || s.kind === "review_failed") && s.data.reviewSha === reviewSha);
  if (!reviewVerdict) {
    const ci = await repo.getCiState(reviewSha);
    if (ci.state === "pending" || ci.state === "none") return waitCi(ci.state, reviewPushed.at);
    if (ci.state === "failure") {
      await post("review_failed", "El revisor volvió a reproducir un fallo. A reparar de nuevo.", { reviewSha });
      return nextRound(ctx, inc, round, `Las pruebas del revisor fallan:\n${ci.details}`, post, human);
    }
    await post("review_passed", "El revisor no logró reproducir el error. Aprobado.", { reviewSha });
    return { changed: true };
  }
  if (reviewVerdict.kind === "review_failed") {
    // Igual que con ci_failed: falta el paso "fixing" de la ronda siguiente.
    const ci = await repo.getCiState(reviewSha);
    return nextRound(ctx, inc, round, `Las pruebas del revisor fallan:\n${ci.details}`, post, human);
  }

  // ── 4. Base de datos: respaldo → cambio aditivo (si lo hay) ──
  if (ctx.dbUrl && !has("db_applied")) {
    const change = await getPendingDbChange(project.id, inc.number);
    if (change?.status === "probado") {
      const backup = await createBackup(ctx, "antes_de_cambio", inc.number);
      await post("db_backup", `Respaldo de la base de datos antes del cambio (${backup.tables} tablas, ${backup.rows} filas).`);
      try {
        await applySchemaChange(ctx.dbUrl, change.sql);
        await setDbChangeStatus(change.id, { status: "aplicado", backup_id: backup.id, applied_at: new Date().toISOString() });
        await post("db_applied", `Cambio de estructura aplicado: ${change.reason}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await setDbChangeStatus(change.id, { status: "requiere_humano", backup_id: backup.id, error: msg.slice(0, 500) });
        return human(`No pude aplicar el cambio de estructura (${msg.slice(0, 160)}). El SQL está en el PR; nada se modificó.`);
      }
      return { changed: true };
    }
  }

  // ── 5. Merge a main (solo el commit que aprobó el revisor) ──
  if (!project.auto_merge) return human("Aprobado por el revisor. Merge automático desactivado: espera tu revisión.");
  try {
    const sha = await repo.mergePullRequest(pr.number, `${inc.title.replace(/^\u{1FA7A}\s*/u, "")} (#${pr.number})`, reviewSha);
    await post("merged", `PR #${pr.number} mergeado a main. Desplegando a producción…`, { sha });
    return { changed: true };
  } catch (err) {
    if (!(err instanceof GitHubError) || (err.status !== 405 && err.status !== 409)) throw err;
    // Puede que otra petición ya lo haya mergeado.
    const now = await repo.getPullRequest(pr.number);
    if (now.merged && now.merge_commit_sha) {
      await post("merged", `PR #${pr.number} mergeado a main. Desplegando a producción…`, { sha: now.merge_commit_sha });
      return { changed: true };
    }
    // Carreras que se resuelven solas: main avanzó durante el merge o GitHub todavía calcula si se puede.
    if (err.status === 405 && (now.mergeable == null || /base branch was modified/i.test(err.apiMessage ?? ""))) return idle;
    if (err.status === 409) return human("La rama del PR cambió después de la revisión. No mergeo commits sin revisar: el PR espera tu revisión.");
    // Conflictos o reglas de la rama: reintentarlo cada minuto no lo arregla.
    return human(`GitHub no permitió el merge automático${err.apiMessage ? ` (${err.apiMessage.slice(0, 160)})` : ""}. El PR espera tu revisión.`);
  }
}

/** Pausa por límite: si ya hay créditos, retoma exactamente el trabajo que se detuvo. */
async function resume(ctx: ProjectContext, inc: Incident, data: StepData): Promise<Advance> {
  // No se espera a resumeAt: si el usuario sube de plan, retoma de inmediato.
  const ok = await checkAllowance(ctx.project.owner_id, isCriticalWork(inc.repair)).catch(() => null);
  if (!ok?.ok) return idle;
  const stage = data.stage;
  const job =
    stage === "diagnose" && inc.payload
      ? startAgent(ctx, inc.number, inc.payload)
      : stage === "repair" && inc.repair
        ? startRepair(ctx, inc.number, inc.repair)
        : stage === "review" && data.fixSha
          ? guarded(ctx, inc, "El revisor", () => reviewFix(ctx, inc, data.fixSha!, data.round ?? 1), { stage: "review", fixSha: data.fixSha, round: data.round })
          : stage === "retry"
            ? guarded(ctx, inc, "El agente", () => retryFix(ctx, inc, data.round ?? 2, data.feedback ?? ""), { stage: "retry", round: data.round, feedback: data.feedback })
            : null;
  if (!job) {
    // Sin datos para retomar: mejor un humano que una pausa eterna.
    await postStep(ctx.repo, inc.number, "needs_review", "No pude retomar el trabajo pausado. Un humano debe revisarlo.", { pr: inc.pr ?? undefined });
    return { changed: true };
  }
  await postStep(ctx.repo, inc.number, "resumed", "Se renovaron tus créditos: Fixie retoma el trabajo donde se quedó.", { pr: inc.pr ?? undefined, round: data.round });
  return { changed: true, background: job };
}

async function nextRound(
  ctx: ProjectContext,
  inc: Incident,
  round: number,
  feedback: string,
  post: (kind: StepKind, text: string, data?: StepData) => Promise<void>,
  human: (text: string) => Promise<Advance>,
): Promise<Advance> {
  if (round >= MAX_ROUNDS) return human(`Tras ${MAX_ROUNDS} rondas el revisor sigue rompiéndolo. Un humano debe revisar el PR.`);
  const next = round + 1;
  await post("fixing", `Ronda ${next}: corrigiendo con lo que falló…`, { round: next });
  return { changed: true, background: guarded(ctx, inc, "El agente", () => retryFix(ctx, inc, next, feedback), { stage: "retry", round: next, feedback: feedback.slice(0, 4000) }) };
}

/** El commit que sirve producción según /api/version de la app, o null. */
async function liveCommit(appUrl: string): Promise<string | null> {
  const res = await fetch(`${appUrl}/api/version`, { cache: "no-store", signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!res?.ok) return null;
  const commit = ((await res.json().catch(() => ({}))) as { commit?: unknown }).commit;
  return typeof commit === "string" && SHA.test(commit) ? commit : null;
}

async function verify(ctx: ProjectContext, inc: Incident, mergedAt: string): Promise<Advance> {
  const mergeSha = inc.mergeSha;
  if (!mergeSha) return idle;
  const short = mergeSha.slice(0, 7);
  const next = inc.repair ? () => nextRepair(ctx) : undefined;
  const appUrl = ctx.project.app_url?.replace(/\/$/, "");
  if (appUrl) {
    // Producción puede ir por delante del merge (otro commit llegó después): basta con que lo incluya.
    const live = await liveCommit(appUrl);
    const deployed = !!live && (live === mergeSha || (await ctx.repo.includesCommit(live, mergeSha).catch(() => false)));
    if (!deployed) {
      if (!older(mergedAt, DEPLOY_TIMEOUT_MS)) return idle;
      await postStep(
        ctx.repo,
        inc.number,
        "needs_review",
        `Mergeado (commit \`${short}\`), pero en ${DEPLOY_TIMEOUT_MS / 60_000} min producción no mostró ese commit en /api/version. Revisa el despliegue.`,
        { sha: mergeSha },
      );
      return { changed: true, background: next };
    }
  } else if (!inc.repair) {
    await postStep(ctx.repo, inc.number, "verified", `Mergeado (commit \`${short}\`). Sin URL de producción no puedo verificar el despliegue.`, { sha: mergeSha });
    return { changed: true };
  } else if (!["deps", "errors", "pentest_deep"].includes(inc.repair.kind)) {
    // Dependencias, errores y pentest profundo se verifican en el repo; lo demás necesita producción.
    await postStep(ctx.repo, inc.number, "verified", "Mergeado. (Sin URL de producción no puedo verificar el despliegue.)", { sha: mergeSha });
    return { changed: true, background: next };
  }

  if (!inc.repair) {
    await postStep(ctx.repo, inc.number, "verified", `Arreglo en producción (commit \`${short}\`).`, { sha: mergeSha });
    return { changed: true };
  }

  // Pentest profundo: Shannon tarda horas. Las pruebas que reproducen cada
  // explotación ya pasan con el arreglo; el próximo pentest profundo lo confirma.
  if (inc.repair.kind === "pentest_deep") {
    await postStep(
      ctx.repo,
      inc.number,
      "verified",
      `Desplegado (commit \`${short}\`). Las pruebas que reproducen cada explotación pasan con el arreglo; el próximo pentest profundo lo confirma contra la app completa.`,
      { sha: mergeSha },
    );
    return { changed: true, background: next };
  }

  // Reparación: el despliegue no basta, se vuelve a analizar producción.
  const label = REPAIR_LABEL[inc.repair.kind];
  const scan = await runScan(ctx.project, inc.repair.kind);
  if (scan.status !== "ok") {
    // Un análisis que falló no trae hallazgos: no prueba que estén resueltos.
    await postStep(
      ctx.repo,
      inc.number,
      "needs_review",
      `Desplegado (commit \`${short}\`), pero el re-análisis de ${label} no terminó: ${scan.summary.slice(0, 200)} La revisión diaria vuelve a analizar.`,
      { sha: mergeSha },
    );
    return { changed: true, background: next };
  }
  const stillFailing = inc.repair.findings.filter((f) => scan.findings.some((s) => s.id === f.id && !s.passed));
  const fixed = inc.repair.findings.length - stillFailing.length;
  const score = scan.score !== null ? ` Puntaje ${inc.repair.scoreBefore ?? "—"} → ${scan.score}.` : "";
  if (stillFailing.length === 0) {
    await postStep(
      ctx.repo,
      inc.number,
      "verified",
      `Re-análisis de ${label} en producción: ${fixed} de ${inc.repair.findings.length} hallazgos resueltos.${score}`,
      { sha: mergeSha, score: scan.score ?? undefined },
    );
  } else {
    await postStep(
      ctx.repo,
      inc.number,
      "needs_review",
      `Re-análisis en producción: ${fixed} de ${inc.repair.findings.length} resueltos.${score} Siguen: ${stillFailing.map((f) => f.title).join(", ")}. La revisión diaria abre otra reparación con lo que falte.`,
      { sha: mergeSha, score: scan.score ?? undefined },
    );
    // Cuenta como intento fallido para el reintento diario (shouldRetry).
    await ctx.repo.closeIssue(inc.number).catch(() => {});
  }
  return { changed: true, background: next };
}

/**
 * Al terminar una reparación, empieza la siguiente pendiente (una a la vez por
 * proyecto) y despierta al motor para que la lleve hasta el final aunque esto
 * haya corrido desde el panel.
 */
async function nextRepair(ctx: ProjectContext): Promise<void> {
  const { startNextRepair } = await import("../repairs");
  const job = await startNextRepair(ctx.project).catch(() => null);
  if (!job) return;
  await job();
  const { kickMotor } = await import("../motor");
  await kickMotor(ctx.project.id);
}
