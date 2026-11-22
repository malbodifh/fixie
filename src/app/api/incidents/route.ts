import { after } from "next/server";
import { startAgent } from "@/lib/agent/advance";
import { incidentPayloadSchema, recordIncident } from "@/lib/incidents";
import { kickMotor } from "@/lib/motor";
import { findProjectByIngestKey, projectContext } from "@/lib/projects";

export const maxDuration = 300;

/** Ingesta: la app monitoreada reporta un error desde onRequestError. La clave identifica al proyecto. */
export async function POST(req: Request) {
  const key = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  const project = await findProjectByIngestKey(key);
  if (!project) return Response.json({ error: "No autorizado" }, { status: 401 });

  const parsed = incidentPayloadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Formato inválido" }, { status: 400 });

  const ctx = await projectContext(project);
  const { issue, isNew } = await recordIncident(ctx.repo, parsed.data);

  // El agente corre después de responder: la app monitoreada no espera. Luego el
  // motor del servidor lleva el ciclo completo aunque nadie tenga el panel abierto.
  if (isNew) {
    after(async () => {
      await startAgent(ctx, issue.number, parsed.data)();
      await kickMotor(project.id);
    });
  }

  return Response.json({ incident: issue.number, isNew }, { status: isNew ? 201 : 200 });
}
