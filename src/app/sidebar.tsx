"use client";

import { LayoutGrid, LogOut, Menu, MessageCircle, PanelLeftClose, PanelLeftOpen, Plug, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FixieLogo } from "./logo";
import { UsageRing } from "./usage-ring";

type SidebarData = {
  login: string;
  avatarUrl: string | null;
  plan: { label: string; paid: boolean };
  usage: { share: number; label: string } | null;
  collapsed: boolean;
};

type Item = { href: string; label: string; icon: LucideIcon | null; ring?: boolean };

const ITEMS: Item[] = [
  { href: "/proyectos", label: "Proyectos", icon: LayoutGrid },
  { href: "/asistente", label: "Asistente", icon: MessageCircle },
  { href: "/uso", label: "Uso", icon: null, ring: true },
  { href: "/conectar", label: "Conectar tu IA", icon: Plug },
];

const COOKIE = "fixie_sidebar";

export function Sidebar({ data }: { data: SidebarData }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(data.collapsed);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // En móvil, Esc cierra el panel y la página de fondo no se desplaza mientras está abierto.
  // El foco entra al panel al abrirlo y vuelve al botón de menú al cerrarlo.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const overflow = document.body.style.overflow;
    const trigger = menuButton.current;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      trigger?.focus({ preventScroll: true });
    };
  }, [open]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };

  const planBadge = (
    <Link href="/uso" className={`badge shrink-0 ${data.plan.paid ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-2"}`} title="Tu plan">
      {data.plan.label}
    </Link>
  );

  return (
    <>
      {/* Móvil: barra superior con el botón que abre el panel */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-xl backdrop-saturate-150 md:hidden">
        <div className="flex items-center gap-2">
          <button
            ref={menuButton}
            type="button"
            onClick={() => setOpen(true)}
            className="btn btn-ghost btn-sm -ml-2 px-2"
            aria-label="Abrir menú"
            aria-expanded={open}
            aria-controls="mobile-nav"
          >
            <Menu />
          </button>
          <Link href="/proyectos" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <FixieLogo size={20} />
            Fixie
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {data.usage && (
            <Link href="/uso" className="btn btn-ghost btn-sm px-2" aria-label={data.usage.label} title={data.usage.label}>
              <UsageRing share={data.usage.share} />
            </Link>
          )}
          {planBadge}
        </div>
      </div>

      {open && (
        <div id="mobile-nav" className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          {/* El fondo cierra con el ratón; no entra en el orden del teclado (ya está el botón X). */}
          <button type="button" tabIndex={-1} className="fade-in absolute inset-0 bg-black/40" aria-hidden onClick={() => setOpen(false)} />
          <div className="drawer-in absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col border-r border-line bg-bg shadow-float">
            <Panel data={data} pathname={pathname} collapsed={false} onNavigate={() => setOpen(false)}>
              <button ref={closeButton} type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm px-2" aria-label="Cerrar menú">
                <X />
              </button>
            </Panel>
          </div>
        </div>
      )}

      {/* Escritorio: barra lateral fija que se pliega a solo íconos */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface/60 transition-[width] duration-200 ease-out md:flex ${collapsed ? "w-[64px]" : "w-[240px]"}`}
        aria-label="Navegación"
      >
        <Panel data={data} pathname={pathname} collapsed={collapsed}>
          <button
            type="button"
            onClick={toggle}
            className="btn btn-ghost btn-sm px-2 text-fg-3 hover:text-fg"
            aria-label={collapsed ? "Expandir barra lateral" : "Plegar barra lateral"}
            title={collapsed ? "Expandir" : "Plegar"}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </Panel>
      </aside>
    </>
  );
}

function Panel({ data, pathname, collapsed, onNavigate, children }: { data: SidebarData; pathname: string; collapsed: boolean; onNavigate?: () => void; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex h-14 shrink-0 items-center gap-2 px-3 ${collapsed ? "flex-col justify-center gap-1 py-2 h-auto" : "justify-between"}`}>
        <Link href="/proyectos" onClick={onNavigate} className="flex items-center gap-2 rounded-md px-1 text-[15px] font-semibold tracking-tight" title="Fixie">
          <FixieLogo size={22} />
          {!collapsed && "Fixie"}
        </Link>
        {children}
      </div>

      <nav className="flex flex-col gap-0.5 px-2 pt-2" aria-label="Secciones">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={item.ring && data.usage ? data.usage.label : collapsed ? item.label : undefined}
              className={`flex h-9 items-center gap-2.5 rounded-md text-[14px] transition-colors ${collapsed ? "justify-center px-0" : "px-2.5"} ${
                active ? "bg-surface-2 font-medium text-fg" : "text-fg-2 hover:bg-surface-2/70 hover:text-fg"
              }`}
            >
              {item.ring ? (
                data.usage ? <UsageRing share={data.usage.share} /> : <span className="h-4 w-4" />
              ) : (
                Icon && <Icon className={`h-4 w-4 shrink-0 ${active ? "text-accent" : ""}`} strokeWidth={1.75} />
              )}
              <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-line p-2">
        <div className={`flex items-center gap-2 rounded-md p-1.5 ${collapsed ? "flex-col" : ""}`}>
          {data.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full border border-line" />
          ) : (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold uppercase text-fg-2">{data.login.slice(0, 1)}</span>
          )}
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{data.login}</p>
              <Link href="/uso" onClick={onNavigate} className={`text-[12px] ${data.plan.paid ? "text-accent" : "text-fg-3"} hover:underline`}>
                Plan {data.plan.label}
              </Link>
            </div>
          )}
          <form action="/api/auth/logout" method="post">
            <button className="btn btn-ghost btn-sm px-2 text-fg-3 hover:text-fg" aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
