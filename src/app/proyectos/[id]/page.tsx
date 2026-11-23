import { Bug, Check, ChevronRight, Gauge, Github, Globe, ListChecks, MousePointerClick, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";
import { env } from "@/lib/env";
import { listIncidents, listRepairs } from "@/lib/incidents";
import { getOwnedProject, listBackups, projectContext } from "@/lib/projects";
import { latestScans, refreshDeep, type ScanRow } from "@/lib/scans";
import type { ScanKind } from "@/lib/scans/common";
import { coversKnownVulns, KNOWN_VULNS_UPSELL } from "@/lib/plans";
import { requireUserRow } from "@/lib/session";
import { Console } from "../../console";
import { AppShell } from "../../app-shell";
import { SNIPPET } from "../../snippet";
import { timeAgo } from "../../time";
import { DatabasePanel, InstallPanel, SettingsPanel } from "./panels";
import { FullReview } from "./full-review";
import { ScanPanel, type ScanView } from "./scan-panel";

const TABS = [
  { id: "errores", icon: Bug, label: "Errores", desc: "Fallos en producción y la revisión de cada noche. Fixie los reproduce, los arregla y verifica, aunque estés durmiendo." },
  { id: "pentesting", icon: ShieldCheck, label: "Pentesting", desc: "Qué tan segura es tu app, por fuera, por dentro y en sus dependencias. Fixie repara lo que encuentra con un PR probado." },
  { id: "conversion", icon: MousePointerClick, label: "Conversión", desc: "Lo que hace que un visitante compre, se registre o te escriba. Fixie propone; tú eliges qué cambiar." },
  { id: "lighthouse", icon: Gauge, label: "Lighthouse", desc: "La auditoría de Google en móvil y escritorio. Si algo baja de 90, Fixie lo sube." },
  { id: "completa", icon: ListChecks, label: "Revisión completa", desc: "Las 4 pruebas con un clic. Fixie repara solo lo que se arregla con código y lo publica tras las pruebas y el revisor, como siempre." },
] as const;
type TabId = (typeof TABS)[number]["id"] | "ajustes";

const KIND: Record<"pentesting" | "conversion" | "lighthouse", ScanKind> = { pentesting: "pentest", conversion: "conversion", lighthouse: "lighthouse" };

export default function ProjectPage({ params, searchParams }: PageProps<"/proyectos/[id]">) {
  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-4 pb-20 pt-8 md:px-6">
        <Suspense
          fallback={
            <div className="flex flex-col gap-6" aria-label="Cargando proyecto">
              <span className="skeleton h-8 w-60" />
              <span className="skeleton h-10" />
              <span className="skeleton h-80" />
            </div>
          }
        >
          <ProjectDashboard params={params} searchParams={searchParams} />
        </Suspense>
      </main>
    </AppShell>
  );
}

function toView(scan: ScanRow | undefined): ScanView | null {
  return scan
    ? { status: scan.status, score: scan.score, summary: scan.summary, findings: scan.findings, meta: scan.meta, createdAt: scan.created_at }
    : null;
}

type Status = { text: string; cls: string; title: string; check?: boolean; live?: boolean };

async function ProjectDashboard({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const user = await requireUserRow();
  const project = await getOwnedProject(user.id, id);
  if (!project) notFound();

  const requested = typeof query.tab === "string" ? query.tab : "errores";
  const tab: TabId = [...TABS.map((t) => t.id), "ajustes"].includes(requested) ? (requested as TabId) : "errores";

  const ctx = await projectContext(project);
  const [scans, incidents, repairs] = await Promise.all([
    latestScans(project.id).then(async (s) => {
      // Un pentest profundo en curso: se consulta a GitHub al abrir el panel.
      if (s.pentest_deep?.status === "running") s.pentest_deep = await refreshDeep(project, s.pentest_deep).catch(() => s.pentest_deep);
      return s;
    }),
    listIncidents(ctx.repo).catch(() => null),
    listRepairs(ctx.repo).catch(() => []),
  ]);
  // La reparación más reciente de cada análisis (la lista viene de la más nueva a la más vieja).
  const latestRepair = (kind: ScanKind) => repairs.find((r) => r.kind === kind) ?? null;
  const open = incidents?.filter((i) => i.open).length ?? null;
  // Un error detenido sigue sin arreglar hasta que un incidente posterior del mismo error se arregla.
  // Se cuentan errores distintos, no cada vez que ocurrieron.
  const stopped = new Set(
    incidents?.filter((i) => i.stopped && !incidents.some((j) => j.number > i.number && j.title === i.title && !j.open && !j.stopped)).map((i) => i.title),
  ).size;

  const reviewKinds = ["errors", "pentest", "conversion", "lighthouse"] as const;
  const status = (t: (typeof TABS)[number]["id"]): Status => {
    if (t === "completa") {
      if (reviewKinds.some((k) => latestRepair(k)?.open)) return { text: "Reparando", cls: "bg-accent-soft text-accent", title: "Fixie está reparando lo que encontró", live: true };
      const scores = reviewKinds.map((k) => scans[k]?.score).filter((n): n is number => typeof n === "number");
      if (scores.length === 0) return { text: "Sin analizar", cls: "bg-surface-2 text-fg-3", title: "Todavía no corres las 4 pruebas" };
      const worst = Math.min(...scores);
      const cls = worst >= 90 ? "bg-ok-bg text-ok" : worst >= 50 ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad";
      return { text: `${worst}`, cls, title: `El puntaje más bajo de las ${scores.length} pruebas` };
    }
    if (t === "errores") {
      if (open === null) return { text: "Sin acceso", cls: "bg-surface-2 text-fg-3", title: "No pude leer el repo" };
      if (latestRepair("errors")?.open) return { text: "Reparando", cls: "bg-accent-soft text-accent", title: "Fixie está reparando los errores de la revisión diaria", live: true };
      if (open > 0) return { text: `${open} ${open === 1 ? "abierto" : "abiertos"}`, cls: "bg-bad-bg text-bad", title: "Incidentes abiertos" };
      return stopped > 0
        ? { text: `${stopped} ${stopped === 1 ? "detenido" : "detenidos"}`, cls: "bg-warn-bg text-warn", title: "Errores que Fixie no pudo arreglar: ábrelos y pulsa Diagnosticar y reparar" }
        : { text: "Sano", cls: "bg-ok-bg text-ok", title: "Sin incidentes abiertos", check: true };
    }
    const s = scans[KIND[t]];
    if (latestRepair(KIND[t])?.open || (t === "pentesting" && (latestRepair("deps")?.open || latestRepair("pentest_deep")?.open))) return { text: "Reparando", cls: "bg-accent-soft text-accent", title: "Fixie está reparando los hallazgos", live: true };
    if (!s) return { text: "Sin analizar", cls: "bg-surface-2 text-fg-3", title: "Todavía no hay análisis" };
    if (s.status === "needs_public_url") return { text: "Sin datos", cls: "bg-surface-2 text-fg-3", title: "Necesita la URL pública" };
    if (s.status !== "ok" || s.score === null) return { text: "Revisar", cls: "bg-warn-bg text-warn", title: `Último intento ${timeAgo(s.created_at)}` };
    const cls = s.score >= 90 ? "bg-ok-bg text-ok" : s.score >= 50 ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad";
    return { text: `${s.score}`, cls, title: `Puntaje ${s.score} de 100, ${timeAgo(s.created_at)}` };
  };

  const qr =
    tab === "errores" && project.app_url
      ? await QRCode.toString(project.app_url, { type: "svg", margin: 0, color: { dark: "#0a0a0b", light: "#ffffff" } })
      : null;
  const host = project.app_url?.replace(/^https?:\/\//, "");

  return (
    <>
      {/* Encabezado */}
      <nav aria-label="Ruta" className="flex items-center gap-1 text-[13px] text-fg-3">
        <Link href="/proyectos" className="rounded hover:text-fg">
          Proyectos
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="truncate text-fg-2">{project.name}</span>
      </nav>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 truncate text-[28px] font-semibold tracking-[-0.025em]">{project.name}</h1>
            {coversKnownVulns(user.plan) && (
              <Link
                href={`/proyectos/${project.id}?tab=pentesting`}
                className="badge shrink-0 bg-accent-soft text-accent hover:opacity-90"
                title="Fixie revisa tus dependencias cada 15 minutos contra las vulnerabilidades conocidas (OSV y el catálogo CISA KEV) y las actualiza en cuanto existe una versión segura."
              >
                <ShieldCheck />
                Cobertura de vulnerabilidades conocidas
              </Link>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-2">
            <a href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded hover:text-fg">
              <Github className="h-3.5 w-3.5" />
              {project.repo}
            </a>
            {host && (
              <a href={project.app_url!} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded hover:text-fg">
                <Globe className="h-3.5 w-3.5" />
                {host}
              </a>
            )}
          </div>
        </div>
        <Link href="?tab=ajustes" scroll={false} aria-current={tab === "ajustes" ? "page" : undefined} className={`btn btn-sm ${tab === "ajustes" ? "btn-secondary" : "btn-outline"}`}>
          <Settings />
          Ajustes
        </Link>
      </div>

      {/* Las categorías */}
      <nav className="mt-8 border-line xl:border-b" aria-label="Categorías">
        <ul className="grid grid-cols-2 gap-1.5 md:grid-cols-5 xl:flex xl:gap-1">
          {TABS.map((t) => {
            const s = status(t.id);
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <li key={t.id} className={t.id === "completa" ? "col-span-2 md:col-span-1" : undefined}>
                <Link
                  href={`?tab=${t.id}`}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex flex-col items-start gap-1.5 rounded-lg border px-3 py-2.5 xl:flex-row xl:items-center xl:gap-2 text-[14px] font-medium transition-colors xl:rounded-b-none xl:rounded-t-md xl:border-0 xl:pb-3 xl:pt-2 ${
                    active ? "border-accent bg-accent-soft text-fg xl:bg-transparent" : "border-line text-fg-2 hover:text-fg"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 shrink-0 ${active ? "text-accent" : ""}`} strokeWidth={1.75} />
                    {t.label}
                  </span>
                  <span className={`badge tabular ${s.cls}`} title={s.title}>
                    {s.check && <Check strokeWidth={2.5} />}
                    {s.live && <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
                    {s.text}
                  </span>
                  {active && <span className="absolute inset-x-2 bottom-0 hidden h-0.5 rounded-full bg-accent xl:block" aria-hidden />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <p className="mt-4 text-[14px] text-fg-2">
        {tab === "ajustes" ? "Conexiones, base de datos y clave de instalación del proyecto." : TABS.find((t) => t.id === tab)?.desc}
      </p>

      {/* Contenido de la categoría */}
      <div className="mt-6">
        {tab === "errores" && (
          <div className="flex flex-col gap-6">
            {qr && project.app_url && (
              <div className="card flex items-center gap-4 p-3 pr-5 md:max-w-md">
                <div className="w-[72px] shrink-0 rounded-lg border border-line bg-white p-1.5" dangerouslySetInnerHTML={{ __html: qr }} />
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold">Rómpela tú</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-fg-2">Escanea, provoca un error en producción y mira cómo Fixie lo arregla aquí.</p>
                </div>
              </div>
            )}
            <Console projectId={project.id} />
            <section className="mt-6 flex flex-col gap-4" aria-labelledby="nightly-title">
              <SectionTitle id="nightly-title" title="Revisión diaria" badge="Cada noche" />
              <ScanPanel
                key="errors"
                projectId={project.id}
                kind="errors"
                scan={toView(scans.errors)}
                appUrl={project.app_url}
                verified={!!project.verified_at}
                repair={latestRepair("errors")}
              />
            </section>
          </div>
        )}

        {tab === "completa" && (
          <FullReview
            projectId={project.id}
            hasUrl={!!project.app_url}
            rows={(
              [
                ["errores", "errors"],
                ["pentesting", "pentest"],
                ["conversion", "conversion"],
                ["lighthouse", "lighthouse"],
              ] as const
            ).map(([id, kind]) => ({
              id,
              score: scans[kind]?.score ?? null,
              summary: scans[kind]?.summary ?? null,
              createdAt: scans[kind]?.created_at ?? null,
              repairing: !!latestRepair(kind)?.open,
            }))}
          />
        )}

        {(tab === "pentesting" || tab === "conversion" || tab === "lighthouse") && (
          <ScanPanel
            key={tab}
            projectId={project.id}
            kind={KIND[tab]}
            scan={toView(scans[KIND[tab]])}
            appUrl={project.app_url}
            verified={!!project.verified_at}
            repair={latestRepair(KIND[tab])}
          />
        )}

        {tab === "pentesting" && (
          <section className="mt-12 flex flex-col gap-4" aria-labelledby="deep-title">
            <SectionTitle id="deep-title" title="Pentest profundo" badge="Shannon · cada semana" />
            <ScanPanel
              key="pentest_deep"
              projectId={project.id}
              kind="pentest_deep"
              scan={toView(scans.pentest_deep)}
              appUrl={project.app_url}
              verified={!!project.verified_at}
              repair={latestRepair("pentest_deep")}
            />
          </section>
        )}

        {tab === "pentesting" && (
          <section className="mt-12 flex flex-col gap-4" aria-labelledby="deps-title">
            {coversKnownVulns(user.plan) ? (
              <>
                <SectionTitle id="deps-title" title="Dependencias vulnerables" badge="Vigilancia 24/7" live />
                <ScanPanel
                  key="deps"
                  projectId={project.id}
                  kind="deps"
                  scan={toView(scans.deps)}
                  appUrl={project.app_url}
                  verified={!!project.verified_at}
                  repair={latestRepair("deps")}
                />
              </>
            ) : (
              <>
                <SectionTitle id="deps-title" title="Dependencias vulnerables" />
                <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                      <ShieldCheck className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-[15px] font-medium">{KNOWN_VULNS_UPSELL}</p>
                      <p className="mt-1 max-w-xl text-[14px] text-fg-2">
                        Fixie revisa tus dependencias cada 15 minutos contra las vulnerabilidades conocidas (OSV y el catálogo CISA KEV) y las actualiza con un PR probado en
                        cuanto existe una versión segura.
                      </p>
                    </div>
                  </div>
                  <Link href="/uso" className="btn btn-outline shrink-0">
                    Ver planes
                  </Link>
                </div>
              </>
            )}
          </section>
        )}

        {tab === "ajustes" && (
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <SettingsPanel projectId={project.id} name={project.name} appUrl={project.app_url} autoMerge={project.auto_merge} />
            <InstallPanel projectId={project.id} baseUrl={env.baseUrl()} keyHint={project.ingest_key_hint} snippet={SNIPPET} />
            <div className="lg:col-span-2">
              <DatabasePanel
                projectId={project.id}
                label={project.db_label}
                backups={(project.db_label ? await listBackups(project.id) : []).map((b) => ({
                  id: b.id,
                  reason: b.reason,
                  tables: b.tables,
                  rows: b.rows,
                  bytes: b.bytes,
                  createdAt: b.created_at,
                  incident: b.incident,
                }))}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function SectionTitle({ id, title, badge, live }: { id: string; title: string; badge?: string; live?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 id={id} className="text-[18px] font-semibold tracking-tight">
        {title}
      </h2>
      {badge && (
        <span className={`badge ${live ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-2"}`}>
          {live && <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
          {badge}
        </span>
      )}
    </div>
  );
}
