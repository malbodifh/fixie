import { after } from "next/server";
import { cronAuthorized, unauthorized } from "@/lib/cron";
import { claimMotor, driveOnce, kickMotor, MOTOR_INTERVAL_MS, releaseMotor } from "@/lib/motor";
import { getProjectById } from "@/lib/projects";

export const maxDuration = 300;

/** Tiempo máximo de una vuelta antes de volver a llamarse (deja margen bajo maxDuration). */
const BUDGET_MS = 200_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const started = Date.now();
    let open = 1;
    try {
      const round = await driveOnce(project);
      open = round.open;
      // Los agentes pueden tardar más que la función: se espera hasta BUDGET_MS y la
      // cadena sigue igual. Si la función muere, el agente cortado lo detecta advance().
      await Promise.race([Promise.allSettled(round.background.map((job) => job())), sleep(BUDGET_MS)]);
    } catch (err) {
      console.error("[motor]", id, err);
    } finally {
      // La cadena nunca muere por un error: si queda algo abierto, se vuelve a llamar.
      if (open === 0) await releaseMotor(id, lease).catch((err) => console.error("[motor]", id, err));
      else {
        await sleep(Math.min(MOTOR_INTERVAL_MS, Math.max(0, BUDGET_MS + MOTOR_INTERVAL_MS - (Date.now() - started))));
        await kickMotor(id, lease).catch((err) => console.error("[motor]", id, err));
      }
    }
  });
  return Response.json({ started: true }, { status: 202 });
}
