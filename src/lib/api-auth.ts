import "server-only";
import { projectContext, getOwnedProject, type ProjectContext } from "./projects";
import { getUserRow } from "./session";

/** Para rutas de API: el proyecto solo si es del usuario con sesión. */
export async function ownedProjectContext(id: string): Promise<ProjectContext | Response> {
  const user = await getUserRow();
  if (!user) return Response.json({ error: "Inicia sesión" }, { status: 401 });
  const project = await getOwnedProject(user.id, id);
  if (!project) return Response.json({ error: "Proyecto no encontrado" }, { status: 404 });
  return projectContext(project);
}
