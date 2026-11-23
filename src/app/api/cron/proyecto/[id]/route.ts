import { after } from "next/server";
import { cronAuthorized, unauthorized } from "@/lib/cron";
import { kickMotor } from "@/lib/motor";
import { getProjectById, projectContext } from "@/lib/projects";
import { startNextRepair } from "@/lib/repairs";
import { latestScan, refreshDeep, runScan, startDeep } from "@/lib/scans";
import { deepSetup } from "@/lib/scans/shannon";

export const maxDuration = 300;

const WEEK_MS = 7 * 24 * 60 * 60_000;

/**
 * La revisión diaria de un proyecto, sin que nadie lo pida:
 * 1. Errores, pentesting, Lighthouse (móvil y escritorio) y conversión.
 * 2. Pentest profundo con Shannon una vez por semana (tarda horas y cuesta tokens).
 * 3. Repara todo lo que no necesita una decisión, una reparación tras otra.
 *    Conversión solo propone: el usuario elige qué textos cambiar.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/cron/proyecto/[id]">) {
  if (!cronAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "No existe" }, { status: 404 });

  after(async () => {
    const kinds = ["errors", ...(project.app_url ? (["pentest", "lighthouse", "conversion"] as const) : [])] as const;
    for (const kind of kinds) {
      await runScan(project, kind).catch((err) => console.error("[diario]", project.name, kind, err));
    }

    // Cada fase falla por separado: un error en el pentest profundo no deja sin reparar ni sin motor.
    try {
      const deep = await latestScan(project.id, "pentest_deep");
      if (deep?.status === "running") await refreshDeep(project, deep);
      else if (!deep || Date.now() - Date.parse(deep.created_at) > WEEK_MS) {
        const setup = await deepSetup((await projectContext(project)).repo);
        if (setup.workflow && setup.secret) await startDeep(project);
      }
    } catch (err) {
      console.error("[diario]", project.name, "pentest_deep", err);
    }

    try {
      const job = await startNextRepair(project);
      if (job) await job();
    } catch (err) {
      console.error("[diario]", project.name, "reparación", err);
    }
    await kickMotor(project.id);
  });
  return Response.json({ started: true }, { status: 202 });
}
