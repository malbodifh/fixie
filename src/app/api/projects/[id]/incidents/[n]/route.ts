import { after } from "next/server";
import { advanceIncident } from "@/lib/agent/advance";
import { ownedProjectContext } from "@/lib/api-auth";
import type { PullFile } from "@/lib/github";
import { getIncident } from "@/lib/incidents";

export const maxDuration = 300;

// Los archivos del PR cambian con cada ronda: se cachean por commit.
const diffCache = new Map<string, PullFile[]>();

/** Detalle de un incidente. Cada consulta además avanza su ciclo en el entorno de pruebas. */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/incidents/[n]">) {
  const { id, n: raw } = await ctx.params;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return Response.json({ error: "Número inválido" }, { status: 400 });

  const project = await ownedProjectContext(id);
  if (project instanceof Response) return project;

  let incident = await getIncident(project.repo, n);
  if (!incident) return Response.json({ error: "No encontrado" }, { status: 404 });

  // Si el motor del servidor ya empuja este proyecto, el panel solo lee (evita pasos duplicados).
  const motorRunning = !!project.project.motor_lease && Date.parse(project.project.motor_lease) > Date.now();
  if (!motorRunning) {
    const step = await advanceIncident(project, incident);
    if (step.background) after(step.background);
    if (step.changed) incident = (await getIncident(project.repo, n)) ?? incident;
  }

  let diff: PullFile[] = [];
  if (incident.pr) {
    const key = `${project.project.id}:${incident.pr}:${incident.steps.length}`;
    diff = diffCache.get(key) ?? (await project.repo.listPullFiles(incident.pr));
    diffCache.set(key, diff);
  }

  return Response.json({ incident, diff });
}
