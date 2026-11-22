import { ownedProjectContext } from "@/lib/api-auth";
import { listIncidents } from "@/lib/incidents";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/incidents">) {
  const project = await ownedProjectContext((await ctx.params).id);
  if (project instanceof Response) return project;
  return Response.json({ incidents: await listIncidents(project.repo) });
}
