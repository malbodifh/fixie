import { cronAuthorized, unauthorized } from "@/lib/cron";
import { createBackup, listProjectsWithDb, projectContext } from "@/lib/projects";

export const maxDuration = 300;

/**
 * Respaldo semanal (Vercel Schedules, lunes 06:00 UTC) de la base de datos de cada
 * proyecto vinculado. Los análisis y reparaciones van en la revisión diaria.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return unauthorized();

  const results: { project: string; step: string; ok: boolean; detail: string }[] = [];
  for (const project of await listProjectsWithDb()) {
    try {
      const backup = await createBackup(await projectContext(project), "semanal");
      results.push({ project: project.name, step: "respaldo", ok: true, detail: `${backup.tables} tablas, ${backup.rows} filas` });
    } catch (err) {
      results.push({ project: project.name, step: "respaldo", ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  }

  return Response.json({ results });
}
