import { after } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { listAllProjects } from "@/lib/projects";
import { startNextRepair, startRepairIfNeeded } from "@/lib/repairs";
import { kickMotor } from "@/lib/motor";
import { computeScan, latestScans, refreshDeep, saveScan } from "@/lib/scans";

export const maxDuration = 300;

/** Se guarda un análisis nuevo solo si cambió algo, o cada 6 h como latido. */
const HEARTBEAT_MS = 6 * 60 * 60_000;

/**
 * Vigilancia de dependencias 24/7 (Vercel Schedules cada 15 min). Si se publica una
 * vulnerabilidad para una versión instalada, Fixie abre la actualización de
 * inmediato: prueba que la reproduce, PR, CI, revisor, merge y re-verificación.
 */
export async function GET(req: Request) {
  const secret = env.cronSecret();
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return Response.json({ error: "No autorizado" }, { status: 401 });

  const results: { project: string; ok: boolean; detail: string }[] = [];
  for (const project of await listAllProjects()) {
    try {
      const result = await computeScan(project, "deps");
      const last = (await latestScans(project.id)).deps;
      const ids = (findings: { id: string; passed: boolean }[]) =>
        findings
          .filter((f) => !f.passed)
          .map((f) => f.id)
          .sort()
          .join(",");
      const changed = !last || last.status !== result.status || ids(last.findings) !== ids(result.findings);
      const stale = !last || Date.now() - Date.parse(last.created_at) > HEARTBEAT_MS;
      const scan = changed || stale ? await saveScan(project, "deps", result) : last;

      const repair = await startRepairIfNeeded(project, scan);
      if (repair) after(async () => {
        await repair();
        await kickMotor(project.id);
      });
      // De paso: un pentest profundo en curso puede haber terminado.
      const deep = (await latestScans(project.id)).pentest_deep;
      if (deep?.status === "running") {
        const done = await refreshDeep(project, deep).catch(() => null);
        if (done && done.status !== "running") {
          const next = await startNextRepair(project).catch(() => null);
          if (next) after(async () => {
            await next();
            await kickMotor(project.id);
          });
        }
      }
      results.push({ project: project.name, ok: result.status !== "error", detail: `${result.summary}${repair ? " · actualizando" : ""}` });
    } catch (err) {
      results.push({ project: project.name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return Response.json({ results });
}
