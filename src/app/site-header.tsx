import { LogOut } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/session";
import { FixieLogo } from "./logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md text-[15px] font-semibold tracking-tight">
          <FixieLogo size={22} />
          Fixie
        </Link>
        <Suspense fallback={<span className="skeleton h-8 w-32" aria-hidden />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}

async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <a href="/api/auth/login" className="btn btn-primary btn-sm">
        Entrar con GitHub
      </a>
    );
  }
  return (
    <nav className="flex items-center gap-1" aria-label="Cuenta">
      <Link href="/proyectos" className="btn btn-ghost btn-sm">
        Proyectos
      </Link>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      {user.avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full border border-line" />
      )}
      <span className="hidden px-1.5 text-[13px] text-fg-2 sm:inline">{user.login}</span>
      <form action="/api/auth/logout" method="post">
        <button className="btn btn-ghost btn-sm px-2" aria-label="Cerrar sesión" title="Cerrar sesión">
          <LogOut />
        </button>
      </form>
    </nav>
  );
}
