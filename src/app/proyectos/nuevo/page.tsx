import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { listWritableRepos } from "@/lib/github";
import { requireUserRow } from "@/lib/session";
import { SiteHeader } from "../../site-header";
import { NewProjectForm } from "./new-project-form";

export const metadata = { title: "Nuevo proyecto" };

export default function NewProjectPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[680px] flex-1 flex-col px-4 pb-20 pt-8 md:px-6">
        <nav aria-label="Ruta" className="flex items-center gap-1 text-[13px] text-fg-3">
          <Link href="/proyectos" className="rounded hover:text-fg">
            Proyectos
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-fg-2">Nuevo</span>
        </nav>
        <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.025em]">Conecta tu app</h1>
        <p className="mt-1 text-[14px] text-fg-2">Vincula el repo, la URL de producción y la base de datos. Todo se puede cambiar después.</p>
        <div className="mt-8">
          <Suspense fallback={<div className="skeleton h-96" aria-label="Cargando" />}>
            <FormWithRepos />
          </Suspense>
        </div>
      </main>
    </>
  );
}

async function FormWithRepos() {
  const user = await requireUserRow();
  const repos = await listWritableRepos(decrypt(user.github_token_enc)).catch(() => []);
  return <NewProjectForm repos={repos} baseUrl={env.baseUrl()} />;
}
