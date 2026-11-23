"use client";

import { useEffect, useState } from "react";
import type { IncidentData, RepairKind, Stage } from "@/lib/model";
import { simulatedSnapshot } from "@/lib/simulation";
import { simulatedRepair } from "@/lib/simulation-repair";

export type IncidentSource =
  | { kind: "live"; projectId: string; number: number }
  | { kind: "sim"; startedAt: number }
  | { kind: "sim-repair"; repair: RepairKind; startedAt: number };

export const TERMINAL: Stage[] = ["verificado", "fallido", "revision", "pausado"];

// Cada cuánto se consulta un incidente real: rápido mientras trabaja y lento en
// pausa, porque el motor lo retoma solo cuando se renuevan los créditos.
const LIVE_MS = 4000;
const PAUSED_MS = 30_000;

/** Datos de un incidente: real (consulta la API cada 4 s) o simulado. */
export function useIncident(source: IncidentSource) {
  const [data, setData] = useState<IncidentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Al reintentar, el incidente vuelve a trabajar: se reanuda la consulta periódica.
  const [nonce, setNonce] = useState(0);

  const key =
    source.kind === "live" ? `live-${source.projectId}-${source.number}` : source.kind === "sim" ? `sim-${source.startedAt}` : `sim-${source.repair}-${source.startedAt}`;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    if (source.kind !== "live") {
      const tick = () => {
        if (!alive) return;
        const snap = source.kind === "sim" ? simulatedSnapshot(source.startedAt, Date.now()) : simulatedRepair(source.repair, source.startedAt, Date.now());
        setData(snap);
        if (!TERMINAL.includes(snap.incident.stage)) timer = setTimeout(tick, 500);
      };
      tick();
    } else {
      const load = async () => {
        let wait = LIVE_MS;
        try {
          const res = await fetch(`/api/projects/${source.projectId}/incidents/${source.number}`, { cache: "no-store" });
          if (!res.ok) throw new Error(`Error ${res.status}`);
          const next = (await res.json()) as IncidentData;
          if (!alive) return;
          setData(next);
          setError(null);
          const stage = next.incident.stage;
          // En pausa no termina: se sigue consultando, más despacio, para ver cuándo se retoma.
          if (stage === "pausado") wait = PAUSED_MS;
          else if (TERMINAL.includes(stage)) return;
        } catch (e) {
          if (alive) setError(e instanceof Error ? e.message : "Error");
        }
        if (alive) timer = setTimeout(load, wait);
      };
      load();
    }

    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // key resume el source: cambia solo cuando cambia el incidente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return { data, error, reload: () => setNonce((n) => n + 1) };
}
