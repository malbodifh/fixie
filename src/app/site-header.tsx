import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/session";
import { FixieLogo } from "./logo";

/** Encabezado de la portada. Dentro de la app, la navegación vive en la barra lateral (AppShell). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md text-[15px] font-semibold tracking-tight">
          <FixieLogo size={22} />
          Fixie
        </Link>
        <Suspense fallback={<span className="skeleton h-8 w-32" aria-hidden />}>
          <Entry />
        </Suspense>
      </div>
    </header>
  );
}

async function Entry() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <a href="/api/auth/login" className="btn btn-primary btn-sm">
        Entrar con GitHub
      </a>
    );
  }
  return (
    <Link href="/proyectos" className="btn btn-primary btn-sm">
      Abrir Fixie
      <ArrowRight />
    </Link>
  );
}
