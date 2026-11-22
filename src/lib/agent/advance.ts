import "server-only";
import { applySchemaChange } from "../clientdb";
import { GitHubError } from "../github";
import { markAgentFailed, postStep, type Incident, type RepairInfo, type Step } from "../incidents";
import { MAX_ROUNDS, REPAIR_LABEL, type StepData, type StepKind } from "../model";
import { createBackup, getPendingDbChange, setDbChangeStatus, type ProjectContext } from "../projects";
import { runScan } from "../scans";
import { applyCopyAndOpenPR } from "./copy";
import { updateDepsAndOpenPR } from "./deps";
import { retryFix, diagnoseAndOpenPR } from "./fix";
import { repairAndOpenPR } from "./repair";
import { reviewFix } from "./review";

/** Si CI no reporta nada en este tiempo, se pide revisión humana. */
const NO_CI_TIMEOUT_MS = 4 * 60_000;
/** Un agente en segundo plano que no termina en este tiempo se da por caído. */
const AGENT_TIMEOUT_MS = 8 * 60_000;

// Evita que dos consultas simultáneas avancen el mismo incidente en esta instancia.
const advancing = new Set<string>();

export type Advance = { changed: boolean; background?: () => Promise<void> };
const idle: Advance = { changed: false };

const findLast = (steps: Step[], pred: (s: Step) => boolean) => [...steps].reverse().find(pred);
const older = (iso: string, ms: number) => Date.now() - Date.parse(iso) > ms;

/** Corre un agente en segundo plano; si falla, el incidente queda para un humano. */
function guarded(ctx: ProjectContext, inc: Incident, what: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[autosana] ${what} falló`, err);
      const msg = err instanceof Error ? err.message : String(err);
      await postStep(ctx.repo, inc.number, "needs_review", `${what} falló: ${msg.slice(0, 300)}. Un humano debe revisar el PR.`, { pr: inc.pr ?? undefined }).catch(() => {});
    }
  };
}

/** Primer paso tras la ingesta: diagnóstico y PR del entorno de pruebas. */
export function startAgent(ctx: ProjectContext, issue: number, payload: NonNullable<Incident["payload"]>) {
  return async () => {
    try {
      await diagnoseAndOpenPR(ctx, issue, payload);
    } catch (err) {
      console.error("[autosana] el agente falló", err);
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
      console.error("[autosana] la reparación falló", err);
      // Sin códigos de color de terminal: el mensaje se muestra en el panel.
      const msg = (err instanceof Error ? err.message : "El agente falló antes de terminar.").replace(/\u001b\[[0-9;]*m/g, "").trim();
      await postStep(ctx.repo, issue, "failed", `${msg.slice(0, 400)}\n\nLa revisión de esta noche lo vuelve a intentar.`).catch(() => {});
      await ctx.repo.closeIssue(issue).catch(() => {});
    }
  };
}

/**
 * Máquina de estados del entorno de pruebas. Se ejecuta en cada consulta del
 * panel: cada paso corre en una invocación corta y los agentes largos van en
 * segundo plano (after()). Orden:
 *   reproducir → arreglar → revisor intenta romperlo → (repetir) → BD → merge → verificar
 */
export async function advanceIncident(ctx: ProjectContext, inc: Incident): Promise<Advance> {
  const lock = `${ctx.project.id}:${inc.number}`;
  if (!inc.pr || advancing.has(lock)) return idle;
  const steps = inc.steps;
  const has = (k: StepKind) => steps.some((s) => s.kind === k);
  if (has("verified") || has("failed") || has("needs_review") || has("not_reproduced")) return idle;

  const { repo, project } = ctx;
  const round = inc.round;
  const post = (kind: StepKind, text: string, data: StepData = {}) => postStep(repo, inc.number, kind, text, { pr: inc.pr!, round, ...data });
  const human = async (text: string): Promise<Advance> => {
    await post("needs_review", text);
    return { changed: true };
  };

  advancing.add(lock);
  try {
    // ── Ya mergeado: verificar en producción ──
    if (has("merged")) return await verify(ctx, inc);

    const pr = await repo.getPullRequest(inc.pr);
    if (pr.merged && pr.merge_commit_sha) {
      await post("merged", `PR #${pr.number} mergeado. Desplegando a producción…`, { sha: pr.merge_commit_sha });
      return { changed: true };
    }
    if (pr.state === "closed") return await human("El PR se cerró sin mergear.");

    const opened = findLast(steps, (s) => s.kind === "pr_opened")!;

    // ── 1. Reproducir: la prueba sola debe fallar ──
    if (!has("reproduced")) {
      const ci = await repo.getCiState(opened.data.sha!);
      if (ci.state === "pending") return idle;
      if (ci.state === "none") return older(opened.at, NO_CI_TIMEOUT_MS) ? await human("CI no reportó resultados. El PR espera revisión humana.") : idle;
      if (ci.state === "success") {
        await post("not_reproduced", "La prueba pasó SIN el arreglo: no reproduce el error. No confío en este arreglo; un humano debe revisarlo.");
        return { changed: true };
      }
      await repo.moveBranch(pr.head.ref, opened.data.fixSha!);
      await post("reproduced", "Reproducido: la prueba falla sin el arreglo, igual que en producción. Aplicando el arreglo…", { sha: opened.data.sha });
      return { changed: true };
    }

    // ── 2. El arreglo vigente debe pasar CI ──
    const lastFixing = findLast(steps, (s) => s.kind === "fixing");
    const lastPushed = findLast(steps, (s) => s.kind === "fix_pushed");
    if (lastFixing && (lastFixing.data.round ?? 1) > (lastPushed?.data.round ?? 1)) {
      return older(lastFixing.at, AGENT_TIMEOUT_MS) ? await human("El agente no terminó la nueva ronda a tiempo.") : idle;
    }
    const fixSha = lastPushed?.data.fixSha ?? opened.data.fixSha!;

    const fixVerdict = steps.find((s) => (s.kind === "ci_passed" || s.kind === "ci_failed") && s.data.sha === fixSha);
    if (!fixVerdict) {
      const ci = await repo.getCiState(fixSha);
      if (ci.state === "pending") return idle;
      if (ci.state === "none") return older((lastPushed ?? opened).at, NO_CI_TIMEOUT_MS) ? await human("CI no reportó resultados.") : idle;
      if (ci.state === "failure") {
        await post("ci_failed", `Con el arreglo, CI todavía falla (${ci.failed.join(", ")}).`, { sha: fixSha });
        return nextRound(ctx, inc, round, `CI falló con el arreglo:\n${ci.details}`, post, human);
      }
      await post("ci_passed", round === 1 ? "Con el arreglo, las pruebas pasan." : "Todas las pruebas pasan, incluidas las del revisor.", { sha: fixSha });
      await post("review_started", "Otro agente revisa el arreglo e intenta volver a romperlo…", { sha: fixSha });
      return { changed: true, background: guarded(ctx, inc, "El revisor", () => reviewFix(ctx, inc, fixSha, round)) };
    }
    if (fixVerdict.kind === "ci_failed") return idle;

    // ── 3. El revisor intenta romperlo ──
    const reviewStarted = steps.find((s) => s.kind === "review_started" && s.data.sha === fixSha);
    if (!reviewStarted) {
      await post("review_started", "Otro agente revisa el arreglo e intenta volver a romperlo…", { sha: fixSha });
      return { changed: true, background: guarded(ctx, inc, "El revisor", () => reviewFix(ctx, inc, fixSha, round)) };
    }
    const reviewPushed = steps.find((s) => s.kind === "review_pushed" && s.data.sha === fixSha);
    if (!reviewPushed) return older(reviewStarted.at, AGENT_TIMEOUT_MS) ? await human("El revisor no terminó a tiempo.") : idle;

    const reviewSha = reviewPushed.data.reviewSha!;
    const reviewVerdict = steps.find((s) => (s.kind === "review_passed" || s.kind === "review_failed") && s.data.reviewSha === reviewSha);
    if (!reviewVerdict) {
      const ci = await repo.getCiState(reviewSha);
      if (ci.state === "pending") return idle;
      if (ci.state === "none") return older(reviewPushed.at, NO_CI_TIMEOUT_MS) ? await human("CI no reportó resultados.") : idle;
      if (ci.state === "failure") {
        await post("review_failed", "El revisor volvió a reproducir un fallo. A reparar de nuevo.", { reviewSha });
        return nextRound(ctx, inc, round, `Las pruebas del revisor fallan:\n${ci.details}`, post, human);
      }
      await post("review_passed", "El revisor no logró reproducir el error. Aprobado.", { reviewSha });
      return { changed: true };
    }
    if (reviewVerdict.kind === "review_failed") return idle;

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
          return await human(`No pude aplicar el cambio de estructura (${msg.slice(0, 160)}). El SQL está en el PR; nada se modificó.`);
        }
        return { changed: true };
      }
    }

    // ── 5. Merge a main ──
    if (!project.auto_merge) return await human("Aprobado por el revisor. Merge automático desactivado: espera tu revisión.");
    try {
      const sha = await repo.mergePullRequest(pr.number, `${inc.title.replace(/^\u{1FA7A}\s*/u, "")} (#${pr.number})`);
      await post("merged", `PR #${pr.number} mergeado a main. Desplegando a producción…`, { sha });
    } catch (err) {
      // 405 = ya se mergeó en otra petición o no es mergeable; el próximo ciclo lo resuelve.
      if (!(err instanceof GitHubError && err.status === 405)) throw err;
    }
    return { changed: true };
  } finally {
    advancing.delete(lock);
  }
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
  return { changed: true, background: guarded(ctx, inc, "El agente", () => retryFix(ctx, inc, next, feedback)) };
}

async function verify(ctx: ProjectContext, inc: Incident): Promise<Advance> {
  const mergeSha = inc.mergeSha;
  if (!mergeSha) return idle;
  const appUrl = ctx.project.app_url?.replace(/\/$/, "");
  if (appUrl) {
    const res = await fetch(`${appUrl}/api/version`, { cache: "no-store", signal: AbortSignal.timeout(5000) }).catch(() => null);
    const live = res?.ok ? ((await res.json().catch(() => ({}))) as { commit?: string }).commit : null;
    if (live !== mergeSha) return idle;
  } else if (inc.repair && !["deps", "errors", "pentest_deep"].includes(inc.repair.kind)) {
    // Dependencias, errores y pentest profundo se verifican en el repo; lo demás necesita producción.
    await postStep(ctx.repo, inc.number, "verified", "Mergeado. (Sin URL de producción no puedo verificar el despliegue.)");
    return { changed: true };
  }

  if (!inc.repair) {
    await postStep(ctx.repo, inc.number, "verified", `Arreglo en producción (commit \`${mergeSha.slice(0, 7)}\`).`, { sha: mergeSha });
    return { changed: true };
  }

  // Pentest profundo: Shannon tarda horas. Las pruebas que reproducen cada
  // explotación ya pasan con el arreglo; el próximo pentest profundo lo confirma.
  if (inc.repair.kind === "pentest_deep") {
    await postStep(
      ctx.repo,
      inc.number,
      "verified",
      `Desplegado (commit \`${mergeSha.slice(0, 7)}\`). Las pruebas que reproducen cada explotación pasan con el arreglo; el próximo pentest profundo lo confirma contra la app completa.`,
      { sha: mergeSha },
    );
    return { changed: true, background: () => nextRepair(ctx) };
  }

  // Reparación: el despliegue no basta, se vuelve a analizar producción.
  const scan = await runScan(ctx.project, inc.repair.kind);
  const stillFailing = inc.repair.findings.filter((f) => scan.findings.some((s) => s.id === f.id && !s.passed));
  const fixed = inc.repair.findings.length - stillFailing.length;
  const score = scan.score !== null ? ` Puntaje ${inc.repair.scoreBefore ?? "—"} → ${scan.score}.` : "";
  if (stillFailing.length === 0) {
    await postStep(
      ctx.repo,
      inc.number,
      "verified",
      `Re-análisis de ${REPAIR_LABEL[inc.repair.kind]} en producción: ${fixed} de ${inc.repair.findings.length} hallazgos resueltos.${score}`,
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
    await ctx.repo.closeIssue(inc.number).catch(() => {});
  }
  return { changed: true, background: () => nextRepair(ctx) };
}

/** Al terminar una reparación, empieza la siguiente pendiente (una a la vez por proyecto). */
async function nextRepair(ctx: ProjectContext): Promise<void> {
  const { startNextRepair } = await import("../repairs");
  const job = await startNextRepair(ctx.project).catch(() => null);
  if (job) await job();
}
