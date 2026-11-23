import { cronAuthorized, unauthorized } from "@/lib/cron";
import { env } from "@/lib/env";
import { listAllProjects } from "@/lib/projects";

export const maxDuration = 60;

/**
 * Vigilancia de dependencias 24/7 (Vercel Schedules cada 15 min, planes de pago).
 * Reparte el trabajo: una invocación por proyecto, para que ninguno espere a otro
 * ni la vigilancia se corte cuando haya muchos proyectos.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return unauthorized();
  const projects = await listAllProjects();
  const results = await Promise.all(
    projects.map(async (p) => {
      const res = await fetch(`${env.baseUrl()}/api/cron/dependencias/${p.id}`, {
        method: "POST",
        headers: { authorization: req.headers.get("authorization") ?? "" },
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      return { project: p.name, started: res?.status === 202 };
    }),
  );
  return Response.json({ results });
}
