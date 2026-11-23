import { after } from "next/server";
import { cronAuthorized, unauthorized } from "@/lib/cron";
import { kickMotor } from "@/lib/motor";
import { coversKnownVulns } from "@/lib/plans";
import { getProjectById } from "@/lib/projects";
import { startNextRepair, startRepairIfNeeded } from "@/lib/repairs";
import { computeScan, latestScans, refreshDeep, saveScan } from "@/lib/scans";
import { planOf } from "@/lib/usage";

export const maxDuration = 300;

/** Se guarda un análisis nuevo solo si cambió algo, o cada 6 h como latido. */
const HEARTBEAT_MS = 6 * 60 * 60_000;

const failing = (findings: { id: string; passed: boolean }[]) =>
  findings
    .filter((f) => !f.passed)
    .map((f) => f.id)
    .sort()
    .join(",");

/**
 * La vigilancia de dependencias de un proyecto. Si se publica una vulnerabilidad para una
 * versión instalada, Fixie abre la actualización de inmediato: prueba que la reproduce, PR,
 * CI, revisor, merge y re-verificación. De paso revisa si terminó un pentest profundo.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/cron/dependencias/[id]">) {
  if (!cronAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "No existe" }, { status: 404 });

  after(async () => {
    try {
      const deep = (await latestScans(project.id)).pentest_deep;
      if (deep?.status === "running") {
        const done = await refreshDeep(project, deep);
        if (done.status !== "running") {
          const next = await startNextRepair(project);
          if (next) await next();
        }
      }
    } catch (err) {
      console.error("[dependencias]", project.name, "pentest_deep", err);
    }

    try {
      // La vigilancia de vulnerabilidades conocidas es de los planes de pago.
      if (coversKnownVulns(await planOf(project.owner_id))) {
        const result = await computeScan(project, "deps");
        const last = (await latestScans(project.id)).deps;
        const changed = !last || last.status !== result.status || failing(last.findings) !== failing(result.findings);
        const stale = !last || Date.now() - Date.parse(last.created_at) > HEARTBEAT_MS;
        const scan = changed || stale ? await saveScan(project, "deps", result) : last;
        const repair = await startRepairIfNeeded(project, scan);
        if (repair) await repair();
      }
    } catch (err) {
      console.error("[dependencias]", project.name, err);
    }
    await kickMotor(project.id);
  });
  return Response.json({ started: true }, { status: 202 });
}
