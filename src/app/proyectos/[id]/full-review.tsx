"use client";

import { Bug, Gauge, MousePointerClick, Play, ShieldCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Mascot } from "../../mascot";
import { timeAgo } from "../../time";
import { runFullReviewAction, type ActionState } from "../actions";
import { Note } from "../ui";

export type ReviewRow = {
  id: "errores" | "pentesting" | "conversion" | "lighthouse";
  score: number | null;
  summary: string | null;
  createdAt: string | null;
  repairing: boolean;
};

const ROWS: Record<ReviewRow["id"], { label: string; icon: LucideIcon; fixes: string }> = {
  errores: { label: "Errores", icon: Bug, fixes: "Se repara solo" },
  pentesting: { label: "Pentesting", icon: ShieldCheck, fixes: "Se repara solo" },
  conversion: { label: "Conversión", icon: MousePointerClick, fixes: "Tú eliges qué cambiar" },
  lighthouse: { label: "Lighthouse", icon: Gauge, fixes: "Se repara solo" },
};

const tone = (score: number) => (score >= 90 ? "bg-ok-bg text-ok" : score >= 50 ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad");

export function FullReview({ projectId, rows, hasUrl }: { projectId: string; rows: ReviewRow[]; hasUrl: boolean }) {
  const [running, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  const repairing = rows.some((r) => r.repairing);

  const run = () => {
    setState(null);
    start(async () => setState(await runFullReviewAction(projectId)));
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div className="flex items-center gap-4">
          <Mascot mode={running ? "loop" : repairing ? "typing" : "idle"} size={56} still={!running && !repairing} title="Fixie" />
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight">Las 4 pruebas de una vez</h2>
            <p className="mt-1 max-w-xl text-[14px] text-fg-2">
              {running
                ? "Fixie está analizando tu app. Lighthouse tarda unos segundos más que el resto."
                : repairing
                  ? "Fixie está reparando lo que encontró. Cada arreglo pasa por pruebas y el revisor antes del merge."
                  : "Errores, pentesting, conversión y Lighthouse. Lo que se arregla con código, Fixie lo repara y lo publica con el ciclo de siempre."}
            </p>
          </div>
        </div>
        <button type="button" onClick={run} disabled={running} className="btn btn-primary shrink-0">
          <Play />
          {running ? "Ejecutando…" : "Ejecutar las 4 pruebas"}
        </button>
      </div>

      <ul className="divide-y divide-line border-t border-line">
        {rows.map((r) => {
          const meta = ROWS[r.id];
          const Icon = meta.icon;
          const pending = running && (hasUrl || r.id === "errores");
          return (
            <li key={r.id}>
              <Link href={`?tab=${r.id}`} scroll={false} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2/70 md:px-6">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-fg-2">
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[14px] font-medium">
                    {meta.label}
                    <span className="text-[12px] font-normal text-fg-3">· {meta.fixes}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-fg-2">
                    {pending
                      ? "Analizando…"
                      : r.repairing
                        ? "Reparando en el entorno de pruebas"
                        : !hasUrl && r.id !== "errores"
                          ? "Necesita la URL de producción"
                          : r.summary
                            ? r.summary
                            : "Sin analizar todavía"}
                    {!pending && !r.repairing && (hasUrl || r.id === "errores") && r.createdAt && (
                      <span className="text-fg-3" suppressHydrationWarning>
                        {" · "}
                        {timeAgo(r.createdAt)}
                      </span>
                    )}
                  </p>
                </div>
                {pending ? (
                  <span className="skeleton h-6 w-10 rounded-full" aria-label="Analizando" />
                ) : r.repairing ? (
                  <span className="badge bg-accent-soft text-accent">
                    <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                    Reparando
                  </span>
                ) : r.score !== null ? (
                  <span className={`badge tabular ${tone(r.score)}`}>{r.score}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {state && (
        <div className="border-t border-line p-4 md:px-6">
          <Note state={state} />
        </div>
      )}
    </section>
  );
}
