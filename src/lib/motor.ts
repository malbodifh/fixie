import "server-only";
import { advanceIncident, type Advance } from "./agent/advance";
import { db, must, type ProjectRow } from "./db";
import { env } from "./env";
import { GitHubError } from "./github";
import { getIncident, type Incident } from "./incidents";
import { DEPLOY_TIMEOUT_MS } from "./model";
import { projectContext } from "./projects";

/**
 * El motor: empuja cada incidente y reparación abiertos de un proyecto sin que
 * nadie tenga el panel abierto (de madrugada, con el cliente durmiendo). Cada
 * vuelta avanza un paso cada uno; si queda algo abierto, la ruta se vuelve a
 * llamar a sí misma en un minuto. Un "lease" en la base de datos garantiza que
 * haya una sola cadena por proyecto.
 */

/**
 * Una vuelta (avanzar, correr agentes, esperar MOTOR_INTERVAL_MS y volver a
 * llamarse) dura hasta el maxDuration de /api/motor (300 s). El lease dura más:
 * si venciera a mitad de vuelta, otra llamada abriría una segunda cadena.
 */
const LEASE_MS = 6 * 60_000;
export const MOTOR_INTERVAL_MS = 60_000;

/** Toma el motor del proyecto. `previous` es el lease de la vuelta anterior de la misma cadena. */
export async function claimMotor(projectId: string, previous: string | null): Promise<string | null> {
  const now = new Date();
  const lease = new Date(now.getTime() + LEASE_MS).toISOString();
  let q = db().from("projects").update({ motor_lease: lease }).eq("id", projectId);
  q = previous ? q.eq("motor_lease", previous) : q.or(`motor_lease.is.null,motor_lease.lt.${now.toISOString()}`);
  const rows = must(await q.select("id")) as { id: string }[];
  return rows.length ? lease : null;
}

export async function releaseMotor(projectId: string, lease: string): Promise<void> {
  await db().from("projects").update({ motor_lease: null }).eq("id", projectId).eq("motor_lease", lease);
}

/** Lo que ya no avanza solo: espera a un humano o está en pausa por límite (se retoma con la revisión diaria). */
const WAITING = new Set(["verificado", "fallido", "revision", "pausado"]);

/**
 * Una vuelta: avanza cada issue abierto un paso. Devuelve cuántos siguen en
 * marcha (sin contar los que esperan) y el trabajo de fondo.
 */
export async function driveOnce(project: ProjectRow): Promise<{ open: number; background: (() => Promise<void>)[] }> {
  const ctx = await projectContext(project);
  const open = await ctx.repo.listIncidentIssues("open");
  // El merge cierra el issue ("Closes #N") antes de verificar el despliegue: los
  // cerrados hace poco como completados siguen hasta quedar verificados.
  const since = new Date(Date.now() - 2 * DEPLOY_TIMEOUT_MS).toISOString();
  const closed = (await ctx.repo.listIncidentIssues("closed", { since })).filter((i) => i.state_reason === "completed");
  const background: (() => Promise<void>)[] = [];
  let running = 0;
  for (const issue of [...open, ...closed]) {
    let inc: Incident | null;
    try {
      inc = await getIncident(ctx.repo, issue.number);
    } catch (err) {
      console.error("[motor]", issue.number, err);
      // Un fallo pasajero de GitHub no apaga el motor: se reintenta en la próxima vuelta.
      if (issue.state === "open" && !(err instanceof GitHubError && (err.status === 404 || err.status === 410))) running++;
      continue;
    }
    if (!inc) continue;
    if (issue.state === "closed" && inc.stage !== "desplegando") continue;
    const step: Advance = await advanceIncident(ctx, inc).catch((err) => {
      console.error("[motor]", issue.number, err);
      return { changed: false };
    });
    if (step.background) background.push(step.background);
    if (step.changed || !WAITING.has(inc.stage)) running++;
  }
  return { open: running, background };
}

/** Despierta el motor de un proyecto (sin esperar a que termine). */
export async function kickMotor(projectId: string, lease: string | null = null): Promise<void> {
  const secret = env.cronSecret();
  if (!secret) return;
  await fetch(`${env.baseUrl()}/api/motor/${projectId}${lease ? `?lease=${encodeURIComponent(lease)}` : ""}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  }).catch((err) => console.error("[motor] no pude despertarlo", err));
}
