import { redirect } from "next/navigation";
import { db, type BackupRow } from "@/lib/db";
import { backupDownloadUrl, getOwnedProject } from "@/lib/projects";
import { getUserRow } from "@/lib/session";

/** Descarga de un respaldo: enlace firmado de 5 minutos, solo para el dueño. */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/backups/[backupId]">) {
  const { id, backupId } = await ctx.params;
  const user = await getUserRow();
  if (!user) return Response.json({ error: "Inicia sesión" }, { status: 401 });
  const project = await getOwnedProject(user.id, id);
  if (!project || !/^[0-9a-f-]{36}$/i.test(backupId)) return Response.json({ error: "No encontrado" }, { status: 404 });
  const { data } = await db().from("db_backups").select("*").eq("id", backupId).eq("project_id", project.id).maybeSingle<BackupRow>();
  if (!data) return Response.json({ error: "No encontrado" }, { status: 404 });
  const url = await backupDownloadUrl(data.storage_path);
  if (!url) return Response.json({ error: "No pude generar el enlace" }, { status: 500 });
  redirect(url);
}
