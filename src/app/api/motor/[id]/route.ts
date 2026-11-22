import { after } from "next/server";
import { cronAuthorized, unauthorized } from "@/lib/cron";
import { claimMotor, driveOnce, kickMotor, MOTOR_INTERVAL_MS, releaseMotor } from "@/lib/motor";
import { getProjectById } from "@/lib/projects";

export const maxDuration = 300;

/**
 * Una vuelta del motor de un proyecto: avanza cada incidente y reparación
 * abiertos un paso, corre el trabajo de los agentes y, si queda algo abierto,
 * se vuelve a llamar en un minuto. Responde al instante; el trabajo sigue en after().
 */
export async function POST(req: Request, ctx: RouteContext<"/api/motor/[id]">) {
  if (!cronAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "No existe" }, { status: 404 });

  const lease = await claimMotor(id, new URL(req.url).searchParams.get("lease"));
  if (!lease) return Response.json({ running: true }, { status: 202 });

  after(async () => {
    try {
      const { open, background } = await driveOnce(project);
      await Promise.allSettled(background.map((job) => job()));
      if (open === 0) return releaseMotor(id, lease);
      await new Promise((r) => setTimeout(r, MOTOR_INTERVAL_MS));
      await kickMotor(id, lease);
    } catch (err) {
      console.error("[motor]", id, err);
      await releaseMotor(id, lease);
    }
  });
  return Response.json({ started: true }, { status: 202 });
}
