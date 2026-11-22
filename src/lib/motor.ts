import "server-only";
import { advanceIncident } from "./agent/advance";
import { db, must, type ProjectRow } from "./db";
import { env } from "./env";
import { getIncident } from "./incidents";
import { projectContext } from "./projects";

/**
 * El motor: empuja cada incidente y reparación abiertos de un proyecto sin que
 * nadie tenga el panel abierto (de madrugada, con el cliente durmiendo). Cada
 * vuelta avanza un paso cada uno; si queda algo abierto, la ruta se vuelve a
 * llamar a sí misma en un minuto. Un "lease" en la base de datos garantiza que
 * haya una sola cadena por proyecto.
 */

const LEASE_MS = 3 * 60_000;
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

/** Una vuelta: avanza cada issue abierto un paso. Devuelve cuántos siguen abiertos y el trabajo de fondo. */
export async function driveOnce(project: ProjectRow): Promise<{ open: number; background: (() => Promise<void>)[] }> {
  const ctx = await projectContext(project);
  const issues = await ctx.repo.listIncidentIssues("open");
  const background: (() => Promise<void>)[] = [];
  for (const issue of issues) {
    const inc = await getIncident(ctx.repo, issue.number).catch(() => null);
    if (!inc) continue;
    const step = await advanceIncident(ctx, inc).catch((err) => {
      console.error("[motor]", issue.number, err);
      return { changed: false };
    });
    if ("background" in step && step.background) background.push(step.background);
  }
  const open = (await ctx.repo.listIncidentIssues("open")).length;
  return { open, background };
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
