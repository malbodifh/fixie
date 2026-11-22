import { cronAuthorized, unauthorized } from "@/lib/cron";
import { env } from "@/lib/env";
import { listAllProjects } from "@/lib/projects";

export const maxDuration = 60;

/**
 * Revisión diaria (Vercel Cron, 07:00 UTC: la 1 de la mañana en Ciudad de México).
 * Reparte el trabajo: una invocación por proyecto, para que ninguno espere a otro.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return unauthorized();
  const projects = await listAllProjects();
  const results = await Promise.all(
    projects.map(async (p) => {
      const res = await fetch(`${env.baseUrl()}/api/cron/proyecto/${p.id}`, {
        method: "POST",
        headers: { authorization: req.headers.get("authorization") ?? "" },
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      return { project: p.name, started: res?.status === 202 };
    }),
  );
  return Response.json({ results });
}
