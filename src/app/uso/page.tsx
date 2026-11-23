import { PauseCircle, Zap } from "lucide-react";
import { Suspense } from "react";
import { allowance, coversKnownVulns, credits, CYCLE_DAYS, WEEKS_PER_CYCLE, dayLabel, fmtCredits, PLAN_ORDER, PLANS, shortDay, type Budget, type Week } from "@/lib/plans";
import { listProjects } from "@/lib/projects";
import { requireUserRow } from "@/lib/session";
import { budgetFor, usageEventsSince, type UsageKind } from "@/lib/usage";
import { AppShell } from "../app-shell";

export const metadata = { title: "Uso" };

// Claves de las filas "Por proyecto" que no son un proyecto existente.
const NO_PROJECT = "";
const DELETED = "deleted";

const KIND_LABEL: Record<UsageKind, string> = {
  incident: "Diagnóstico y arreglo de errores",
  repair: "Reparaciones de hallazgos",
  review: "Agente revisor",
  daily_review: "Revisión diaria del código",
  copy: "Sugerencias de textos",
  chat: "Chat de ayuda",
};

export default function UsagePage() {
  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-8 px-4 pb-20 pt-10 md:px-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Uso</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-fg-2">
            Lo que consume el agente de IA en tu ciclo. Los análisis, la vigilancia de dependencias y los respaldos no gastan créditos.
          </p>
        </div>
        <Suspense
          fallback={
            <div className="grid gap-6 lg:grid-cols-2" aria-label="Cargando consumo">
              <span className="skeleton h-56" />
              <span className="skeleton h-56" />
            </div>
          }
        >
          <Usage />
        </Suspense>
      </main>
    </AppShell>
  );
}

async function Usage() {
  const user = await requireUserRow();
  const budget = await budgetFor(user);
  const [events, projects] = await Promise.all([usageEventsSince(user.id, budget.cycleStart), listProjects(user.id)]);

  const names = new Map(projects.map((p) => [p.id, p.name]));
  const byKind = new Map<UsageKind, number>();
  // Por id: el chat no tiene proyecto (no es un proyecto eliminado) y los
  // proyectos eliminados se juntan en una sola fila.
  const byProject = new Map<string, number>();
  const projectLabel = (key: string) => (key === NO_PROJECT ? "Asistente (sin proyecto)" : key === DELETED ? "Proyectos eliminados" : (names.get(key) ?? key));
  for (const e of events) {
    const c = credits(Number(e.cost_usd));
    byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + c);
    const key = !e.project_id ? NO_PROJECT : names.has(e.project_id) ? e.project_id : DELETED;
    byProject.set(key, (byProject.get(key) ?? 0) + c);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <ThisWeek budget={budget} />
        <Cycle budget={budget} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown
          title="En qué se usó"
          empty="Todavía no hay consumo en este ciclo."
          rows={[...byKind].map(([k, v]) => ({ key: k, label: KIND_LABEL[k] ?? k, value: v }))}
        />
        <Breakdown
          title="Por proyecto"
          empty="Ningún proyecto ha consumido créditos en este ciclo."
          rows={[...byProject].map(([key, v]) => ({ key, label: projectLabel(key), value: v }))}
        />
      </div>
      <PlanTable current={budget.plan} />
    </div>
  );
}

function Bar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warn" | "bad" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : "bg-accent-solid";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="presentation">
      <div className={`h-full rounded-full ${color} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ThisWeek({ budget }: { budget: Budget }) {
  const w = budget.current;
  const available = Math.max(0, w.budget - w.debt);
  const left = Math.max(0, w.remaining);
  const normal = allowance(budget, false);
  const critical = allowance(budget, true);
  const usedShare = available > 0 ? w.spent / available : 1;
  const tone = !normal.ok ? "bad" : usedShare >= 0.8 ? "warn" : "accent";
  const criticalUntil = budget.weeks[1].end;

  return (
    <section className="card overflow-hidden">
      <div className="card-head">
        <p className="text-[14px] font-semibold">Esta semana</p>
        <span className="text-[13px] text-fg-3 tabular">
          Semana {w.index + 1} de {budget.weeks.length} · {shortDay(w.start)} – {shortDay(w.end - 86_400_000)}
        </span>
      </div>
      <div className="flex flex-col gap-4 p-5">
        <div>
          <p className="text-[40px] font-semibold leading-none tracking-tight tabular">{fmtCredits(left)}</p>
          <p className="mt-1.5 text-[14px] text-fg-2">créditos disponibles</p>
        </div>
        <Bar value={w.spent} max={available} tone={tone} />
        <p className="text-[13px] text-fg-3 tabular">
          {fmtCredits(w.spent)} usados de {fmtCredits(available)} · se renueva el {dayLabel(w.end)}
        </p>
        {w.debt > 0 && (
          <p className="text-[13px] text-fg-2 tabular">
            Se descontaron {fmtCredits(w.debt)} créditos del consumo extra de la semana pasada.
          </p>
        )}

        {!normal.ok ? (
          <p className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px] ${normal.reason === "cycle" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}>
            <PauseCircle className="mt-px h-4 w-4 shrink-0" />
            <span>
              {normal.reason === "cycle"
                ? `Llegaste al límite del ciclo. El agente está en pausa hasta el ${dayLabel(normal.resumeAt)}, también para errores críticos.`
                : critical.ok
                  ? `Llegaste al límite de esta semana. Solo los errores críticos se siguen reparando hasta el ${dayLabel(criticalUntil)}; ese consumo se descuenta de la semana siguiente. Lo demás se retoma el ${dayLabel(normal.resumeAt)}.`
                  : `Llegaste al límite de esta semana. El agente está en pausa y retoma el trabajo el ${dayLabel(normal.resumeAt)}.`}
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-fg-2">
            <Zap className="mt-px h-4 w-4 shrink-0 text-fg-3" />
            <span>
              Al llegar a cero, el agente se detiene en ese momento y retoma donde se quedó cuando se renueven tus créditos.
              {PLANS[budget.plan].criticalOverage
                ? " En las semanas 1 y 2 tras tu pago, los errores críticos se reparan aunque no te queden créditos."
                : ""}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

function Cycle({ budget }: { budget: Budget }) {
  const tone = budget.cycleSpent >= budget.cap ? "bad" : budget.cycleSpent >= budget.cap * 0.8 ? "warn" : "accent";
  return (
    <section className="card overflow-hidden">
      <div className="card-head">
        <p className="text-[14px] font-semibold">Ciclo de {CYCLE_DAYS} días</p>
        <span className="text-[13px] text-fg-3 tabular">
          {shortDay(budget.cycleStart)} – {shortDay(budget.cycleEnd - 86_400_000)}
        </span>
      </div>
      <div className="flex flex-col gap-4 p-5">
        <div>
          <p className="text-[15px] tabular">
            <span className="text-[28px] font-semibold tracking-tight">{fmtCredits(budget.cycleSpent)}</span>
            <span className="text-fg-3"> de {fmtCredits(budget.cap)} créditos</span>
          </p>
        </div>
        <Bar value={budget.cycleSpent} max={budget.cap} tone={tone} />
        <ol className="grid grid-cols-4 gap-2" aria-label="Semanas del ciclo">
          {budget.weeks.map((w) => (
            <WeekCell key={w.index} week={w} current={w.index === budget.current.index} future={w.index > budget.current.index} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function WeekCell({ week, current, future }: { week: Week; current: boolean; future: boolean }) {
  const over = week.remaining < 0;
  return (
    <li className={`flex min-w-0 flex-col gap-1.5 rounded-lg border px-2 py-2 ${current ? "border-accent bg-accent-soft/40" : "border-line"}`} aria-current={current ? "true" : undefined}>
      <span className={`text-[12px] font-medium ${current ? "text-accent" : "text-fg-2"}`}>S{week.index + 1}</span>
      <Bar value={week.spent} max={Math.max(week.budget - week.debt, 0.01)} tone={over ? "bad" : "accent"} />
      <span className={`truncate text-[11px] tabular ${future ? "text-fg-3" : over ? "text-bad" : "text-fg-2"}`}>
        {future ? fmtCredits(week.budget) : `${fmtCredits(week.spent)}/${fmtCredits(week.budget - week.debt)}`}
      </span>
    </li>
  );
}

function Breakdown({ title, rows, empty }: { title: string; rows: { key: string; label: string; value: number }[]; empty: string }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  return (
    <section className="card overflow-hidden">
      <div className="card-head">
        <p className="text-[14px] font-semibold">{title}</p>
        {total > 0 && <span className="text-[13px] text-fg-3 tabular">{fmtCredits(total)} créditos</span>}
      </div>
      {sorted.length === 0 ? (
        <p className="px-5 py-8 text-center text-[14px] text-fg-3">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-4 p-5">
          {sorted.map((r) => (
            <li key={r.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-[14px]">
                <span className="truncate">{r.label}</span>
                <span className="shrink-0 text-fg-2 tabular">{fmtCredits(r.value)}</span>
              </div>
              <Bar value={r.value} max={total} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlanTable({ current }: { current: Budget["plan"] }) {
  return (
    <section className="card overflow-hidden">
      <div className="card-head">
        <p className="text-[14px] font-semibold">Créditos por plan</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-line text-[12px] text-fg-3">
              <th className="px-5 py-2.5 font-medium">Plan</th>
              <th className="px-5 py-2.5 font-medium">Por ciclo</th>
              <th className="px-5 py-2.5 font-medium">Por semana</th>
              <th className="px-5 py-2.5 font-medium">Errores críticos sin créditos</th>
              <th className="px-5 py-2.5 font-medium">Vulnerabilidades conocidas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {PLAN_ORDER.map((p) => {
              const plan = PLANS[p];
              const mine = p === current;
              return (
                <tr key={p} className={mine ? "bg-accent-soft/40" : undefined}>
                  <td className="px-5 py-3 font-medium">
                    <span className="flex items-center gap-2">
                      {plan.label}
                      {mine && <span className="badge bg-accent-soft text-accent">Tu plan</span>}
                    </span>
                  </td>
                  <td className="px-5 py-3 tabular">{fmtCredits(plan.monthlyCredits)}</td>
                  <td className="px-5 py-3 tabular">{fmtCredits(plan.monthlyCredits / WEEKS_PER_CYCLE)}</td>
                  <td className="px-5 py-3 text-fg-2">{plan.criticalOverage ? "Se reparan en las semanas 1 y 2" : "Esperan a la semana siguiente"}</td>
                  <td className="px-5 py-3 text-fg-2">{coversKnownVulns(p) ? "Vigilancia cada 15 min" : "No incluida"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
