"use client";

import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { IncidentSummary } from "@/lib/model";
import { SIM_NUMBER } from "@/lib/simulation";
import { IncidentView } from "./incident-view";
import { Mascot } from "./mascot";
import { timeAgo } from "./time";
import type { IncidentSource } from "./use-incident";

/**
 * Lista de incidentes y vista en vivo del seleccionado (por defecto, el más
 * reciente). Sin projectId solo muestra la simulación (portada pública).
 */
export function Console({ projectId, settled = false }: { projectId?: string; settled?: boolean }) {
  const [incidents, setIncidents] = useState<IncidentSummary[] | null>(projectId ? null : []);
  const [selected, setSelected] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [simStartedAt, setSimStartedAt] = useState<number | null>(null);

  // ?sim en la URL arranca la simulación (plan B para la demo). En la portada
  // (`settled`) se muestra una simulación ya terminada; "Simular" la repite.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("sim")) startSim();
    else if (settled) startSim(70_000);
  }, [settled]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/incidents`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { incidents: IncidentSummary[] };
        if (!alive) return;
        setFailed(false);
        setIncidents((prev) => {
          // Si llega un incidente nuevo, la vista salta a él.
          const newest = data.incidents[0]?.number;
          if (newest && prev && prev[0]?.number !== newest) setSelected(newest);
          return data.incidents;
        });
      } catch {
        if (alive) setFailed(true);
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [projectId]);

  /** `ago` en ms: con 70 s la simulación ya terminó (dura 62 s). */
  function startSim(ago = 0) {
    setSimStartedAt(Date.now() - ago);
    setSelected(SIM_NUMBER);
  }

  const simItem: IncidentSummary | null = simStartedAt
    ? {
        number: SIM_NUMBER,
        title: "TypeError: Cannot read properties of undefined (reading 'percent')",
        createdAt: new Date(simStartedAt).toISOString(),
        open: true,
      }
    : null;
  const list = [...(simItem ? [simItem] : []), ...(incidents ?? [])];
  const current = selected ?? list[0]?.number ?? null;

  const source: IncidentSource | null =
    current === null
      ? null
      : current === SIM_NUMBER && simStartedAt
        ? { kind: "sim", startedAt: simStartedAt }
        : projectId
          ? { kind: "live", projectId, number: current }
          : null;

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <nav className="card flex flex-col self-start overflow-hidden" aria-label="Incidentes">
        <div className="card-head px-4 py-3">
          <p className="text-[14px] font-semibold">Incidentes</p>
          <span className="badge bg-surface-2 text-fg-2 tabular">{list.length}</span>
        </div>
        <div className="flex max-h-[60vh] flex-col gap-0.5 overflow-auto p-1.5">
          {incidents === null && !failed && !simItem && (
            <div className="flex flex-col gap-2 p-2" aria-label="Cargando">
              <span className="skeleton h-12" />
              <span className="skeleton h-12" />
            </div>
          )}
          {failed && !simItem && (
            <p className="m-1.5 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad">
              No pude leer los incidentes del repo. Revisa que tu cuenta de GitHub siga teniendo acceso.
            </p>
          )}
          {incidents?.length === 0 && !simItem && (
            <p className="px-2.5 py-3 text-[13px] text-fg-3">{projectId ? "Sin incidentes. Todo sano." : "Prueba una simulación del ciclo completo."}</p>
          )}
          {list.map((i) => {
            const active = i.number === current;
            const isSim = simItem && i.number === SIM_NUMBER;
            return (
              <button
                key={`${isSim ? "sim" : "live"}-${i.number}`}
                onClick={() => setSelected(i.number)}
                aria-current={active}
                className={`flex flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors ${active ? "bg-surface-2" : "hover:bg-surface-2/70"}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${i.open ? "bg-accent" : "bg-ok"}`} aria-hidden />
                  <span className="text-[13px] font-medium tabular">#{i.number}</span>
                  {isSim && <span className="badge bg-accent-soft text-accent">Simulación</span>}
                  <span className="ml-auto text-[12px] text-fg-3">{timeAgo(i.createdAt)}</span>
                </span>
                <span className="line-clamp-2 pl-3.5 text-[13px] leading-snug text-fg-2">{i.title.replace(/^\u{1FA7A}\s*/u, "")}</span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-line p-2">
          <button onClick={() => startSim()} className="btn btn-ghost btn-sm w-full">
            <Play />
            Simular incidente
          </button>
        </div>
      </nav>

      <div className="min-w-0">
        {settled && !source ? (
          <div className="card flex flex-col gap-4 p-6" aria-label="Cargando la simulación">
            <span className="skeleton h-5 w-1/3" />
            <span className="skeleton h-7 w-3/4" />
            <span className="skeleton h-64" />
          </div>
        ) : source ? (
          <IncidentView key={source.kind === "sim" ? `sim-${source.startedAt}` : `live-${source.projectId}-${source.number}`} source={source} />
        ) : (
          <div className="card grid min-h-[420px] place-items-center p-10 text-center">
            <div className="flex max-w-sm flex-col items-center gap-5">
              <Mascot size={104} mode={projectId ? "happy" : "loop"} />
              <div>
                <p className="text-xl font-semibold tracking-tight">{projectId ? "Todo sano por ahora" : "Mira el ciclo completo"}</p>
                <p className="mt-1.5 text-[14px] text-fg-2">
                  {projectId
                    ? "Cuando tu app falle en producción, verás a Fixie trabajar aquí en vivo."
                    : "Reproducir, arreglar, que un revisor intente romperlo y publicar, en un minuto."}
                </p>
              </div>
              <button onClick={() => startSim()} className="btn btn-primary">
                <Play />
                Ver una simulación
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
