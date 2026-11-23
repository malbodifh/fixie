import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { fmtCredits, PLANS } from "@/lib/plans";
import { getUserRow } from "@/lib/session";
import { budgetFor } from "@/lib/usage";
import { Sidebar } from "./sidebar";

/** El marco de la app con sesión: barra lateral desplegable a la izquierda y el contenido a la derecha. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col md:flex-row">
      <Suspense
        fallback={
          <>
            <div className="h-14 border-b border-line md:hidden" aria-hidden />
            <div className="hidden w-[240px] shrink-0 border-r border-line md:block" aria-hidden />
          </>
        }
      >
        <SidebarLoader />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

async function SidebarLoader() {
  const user = await getUserRow();
  if (!user) return null;
  const plan = user.plan ?? "free";
  // Uso de la semana: lo gastado sobre lo disponible (el presupuesto menos la deuda de la semana pasada).
  const week = await budgetFor(user)
    .then((b) => b.current)
    .catch(() => null);
  const available = week ? Math.max(0, week.budget - week.debt) : 0;
  const share = week ? (available > 0 ? week.spent / available : 1) : null;
  const collapsed = (await cookies()).get("fixie_sidebar")?.value === "collapsed";

  return (
    <Sidebar
      data={{
        login: user.login,
        avatarUrl: user.avatar_url,
        plan: { label: PLANS[plan].label, paid: plan !== "free" },
        usage:
          week && share !== null
            ? { share, label: `Uso de esta semana: ${Math.round(Math.min(1, share) * 100)}% (${fmtCredits(week.spent)} de ${fmtCredits(available)} créditos)` }
            : null,
        collapsed,
      }}
    />
  );
}
