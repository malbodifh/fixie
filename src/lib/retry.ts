import "server-only";
import { startAgent, startRepair } from "./agent/advance";
import { hasModelKey } from "./agent/model";
import type { ProjectRow } from "./db";
import { getIncident, postStep } from "./incidents";
import { projectContext } from "./projects";
import { BudgetExceededError, checkAllowance, isCriticalWork } from "./usage";

/**
 * "Diagnosticar y reparar": el ciclo vuelve a empezar desde cero con el estado
 * actual del repo. Lo usan el botón del panel, el chat y el servidor MCP.
 * Devuelve el trabajo de fondo para correrlo en after().
 */
export async function retryIncident(project: ProjectRow, issue: number): Promise<{ error: string } | { job: () => Promise<void> }> {
  if (!hasModelKey()) return { error: "Falta la clave del modelo: agrega DEEPSEEK_API_KEY en la configuración del servidor." };
  const ctx = await projectContext(project);
  const inc = await getIncident(ctx.repo, issue).catch(() => null);
  if (!inc) return { error: `No encontré el incidente #${issue}.` };
  if (!["fallido", "revision", "pausado"].includes(inc.stage)) {
    return { error: inc.stage === "verificado" ? "Este incidente ya está arreglado." : "Fixie ya está trabajando en este incidente." };
  }
  const credit = await checkAllowance(project.owner_id, isCriticalWork(inc.repair));
  if (!credit.ok) return { error: new BudgetExceededError(credit.reason, credit.resumeAt).message };

  const job = inc.repair ? startRepair(ctx, issue, inc.repair) : inc.payload ? startAgent(ctx, issue, inc.payload) : null;
  if (!job) return { error: "A este incidente le faltan los datos del error; no se puede reintentar." };
  // El PR del intento anterior se cierra: el nuevo intento abre uno limpio.
  if (inc.pr) await ctx.repo.closePullRequest(inc.pr).catch(() => {});
  await ctx.repo.reopenIssue(issue);
  await postStep(ctx.repo, issue, "retried", "Reintento: Fixie vuelve a diagnosticar y reparar desde cero.");
  return { job };
}
