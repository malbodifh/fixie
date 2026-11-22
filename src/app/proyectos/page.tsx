import { ChevronRight, Database, GitMerge, Github, Globe, Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { listProjects } from "@/lib/projects";
import { requireUserRow } from "@/lib/session";
import { Mascot } from "../mascot";
import { SiteHeader } from "../site-header";

export const metadata = { title: "Proyectos" };

export default function ProjectsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-8 px-4 pb-20 pt-10 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Proyectos</h1>
            <p className="mt-1 text-[14px] text-fg-2">Cada proyecto une un repo de GitHub con su app en producción.</p>
          </div>
          <Link href="/proyectos/nuevo" className="btn btn-primary">
            <Plus />
            Nuevo proyecto
          </Link>
        </div>
        <Suspense
          fallback={
            <div className="card flex flex-col gap-3 p-4" aria-label="Cargando proyectos">
              <span className="skeleton h-14" />
              <span className="skeleton h-14" />
            </div>
          }
        >
          <ProjectList />
        </Suspense>
      </main>
    </>
  );
}

async function ProjectList() {
  const user = await requireUserRow();
  const projects = await listProjects(user.id);

  if (projects.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-5 px-6 py-16 text-center">
        <Mascot mode="loop" size={104} />
        <div>
          <p className="text-xl font-semibold tracking-tight">Crea tu primer proyecto</p>
          <p className="mx-auto mt-1.5 max-w-md text-[14px] text-fg-2">
            Vincula un repo de GitHub, la URL de producción y, si quieres, tu base de datos. Fixie empieza a vigilar en cuanto pegues la clave.
          </p>
        </div>
        <Link href="/proyectos/nuevo" className="btn btn-primary">
          <Plus />
          Nuevo proyecto
        </Link>
      </div>
    );
  }

  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {projects.map((p) => (
        <li key={p.id}>
          <Link href={`/proyectos/${p.id}`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2/70">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-[15px] font-semibold uppercase text-fg-2">
              {p.name.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{p.name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Github className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{p.repo}</span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{p.app_url ? p.app_url.replace(/^https?:\/\//, "") : "Sin URL"}</span>
                </span>
              </p>
            </div>
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              {p.db_label && (
                <span className="badge bg-surface-2 text-fg-2">
                  <Database />
                  Base de datos
                </span>
              )}
              <span className={`badge ${p.auto_merge ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-2"}`}>
                <GitMerge />
                {p.auto_merge ? "Merge automático" : "Merge manual"}
              </span>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
