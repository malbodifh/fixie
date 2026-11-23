"use client";

import {
  Check,
  ChevronRight,
  CircleCheck,
  Globe,
  Loader2,
  Play,
  RotateCw,
  Settings,
  ShieldAlert,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import type { RepairSummary } from "@/lib/model";
import type { Finding, ScanKind, ScanResult, Severity } from "@/lib/scans/common";
import { DEFAULT_SHANNON_MODEL, SHANNON_MODELS, shannonModel, type ShannonModelId } from "@/lib/shannon-models";
import { IncidentView } from "../../incident-view";
import { timeAgo } from "../../time";
import {
  applyChosenAction,
  enableDeepAction,
  repairNowAction,
  runScanAction,
  verifyOwnershipAction,
  type ActionState,
} from "../actions";
import { keepFields, Note } from "../ui";

export type ScanView = {
  status: ScanResult["status"];
  score: number | null;
  summary: string;
  findings: Finding[];
  meta: Record<string, unknown>;
  createdAt: string;
};

const SEVERITY: Record<
  Severity,
  { label: string; cls: string; order: number }
> = {
  // text-bg y no text-white: en oscuro el rojo es claro y el blanco encima no se lee.
  critico: { label: "Crítico", cls: "bg-bad text-bg", order: 0 },
  alto: { label: "Alto", cls: "bg-bad-bg text-bad", order: 1 },
  medio: { label: "Medio", cls: "bg-warn-bg text-warn", order: 2 },
  bajo: { label: "Bajo", cls: "bg-surface-2 text-fg-2", order: 3 },
  info: { label: "Info", cls: "bg-surface-2 text-fg-3", order: 4 },
};

const COPY: Record<ScanKind, { title: string; what: string; wait: string }> = {
  errors: {
    title: "Revisión diaria de errores",
    what: "Cada noche Fixie recorre las páginas de producción, revisa el CI de tu rama principal y, con IA, solo el código que cambió ese día. Lo que encuentra lo reproduce con una prueba y lo arregla antes de que despiertes.",
    wait: "menos de 1 minuto",
  },
  pentest: {
    title: "Superficie",
    what: "Certificado y protocolo TLS, cabeceras de seguridad, cookies, CORS, versiones expuestas y errores. Con el dominio verificado, también busca 18 rutas sensibles (.env, .git, respaldos). No toca tu app: Fixie repara con un PR probado.",
    wait: "unos segundos",
  },
  pentest_deep: {
    title: "Pentest profundo",
    what: "Shannon, un pentester con IA, lee tu código y ataca una copia de tu app levantada dentro de GitHub Actions: inyecciones, XSS, SSRF, autenticación y autorización. Solo reporta lo que logró explotar. Nunca toca producción.",
    wait: "unas horas",
  },
  conversion: {
    title: "Conversión",
    what: "Acción principal, titular, formularios, enlaces e imágenes rotos, señales de confianza y velocidad percibida, más los textos que más venden. Fixie propone; tú eliges qué cambiar.",
    wait: "unos segundos",
  },
  deps: {
    title: "Dependencias",
    what: "Cada 15 minutos, día y noche, Fixie compara las versiones exactas de tu package-lock con las vulnerabilidades publicadas (OSV y GitHub Advisories) y con las que CISA reporta como explotadas. En cuanto hay parche, actualiza.",
    wait: "unos segundos",
  },
  lighthouse: {
    title: "Lighthouse",
    what: "La auditoría de Google PageSpeed Insights en móvil y en escritorio: rendimiento, accesibilidad, buenas prácticas y SEO. Si alguna categoría baja de 90, Fixie la sube.",
    wait: "hasta 2 minutos",
  },
};

const LH_CATEGORIES = [
  ["performance", "Rendimiento"],
  ["accessibility", "Accesibilidad"],
  ["best-practices", "Buenas prácticas"],
  ["seo", "SEO"],
] as const;

const LH_METRICS = [
  ["first-contentful-paint", "FCP", "Primer contenido"],
  ["largest-contentful-paint", "LCP", "Contenido principal"],
  ["total-blocking-time", "TBT", "Tiempo de bloqueo"],
  ["cumulative-layout-shift", "CLS", "Saltos de diseño"],
  ["speed-index", "SI", "Índice de velocidad"],
] as const;

function toneText(score: number) {
  return score >= 90 ? "text-ok" : score >= 50 ? "text-warn" : "text-bad";
}

/** Convierte `código` en código resaltado. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
          <code
            key={i}
            className="rounded bg-surface-2 px-1 py-px font-mono text-[12px] text-fg"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function ScanPanel({
  projectId,
  kind,
  scan,
  appUrl,
  verified,
  repair,
}: {
  projectId: string;
  kind: ScanKind;
  scan: ScanView | null;
  appUrl: string | null;
  verified: boolean;
  repair: RepairSummary | null;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(
    runScanAction.bind(null, projectId, kind),
    null,
  );
  const copy = COPY[kind];
  const failed = (scan?.findings ?? [])
    .filter((f) => !f.passed)
    .sort((a, b) => SEVERITY[a.severity].order - SEVERITY[b.severity].order);
  const passed = (scan?.findings ?? []).filter((f) => f.passed);
  // Lighthouse: móvil y escritorio (los análisis viejos solo traen móvil).
  const scores = (scan?.meta?.scores ??
    (scan?.meta?.categories ? { movil: scan.meta.categories } : undefined)) as
    Partial<Record<"movil" | "escritorio", Record<string, number>>> | undefined;
  const rawMetrics = scan?.meta?.metrics as Record<string, unknown> | undefined;
  const metrics = (rawMetrics && typeof rawMetrics.movil === "object" ? rawMetrics.movil : rawMetrics) as
    Record<string, string> | undefined;
  const score = scan?.status === "ok" ? scan.score : null;
  const needsUrl = scan?.status === "needs_public_url";
  const running = scan?.status === "running";
  const needsSetup = kind === "pentest_deep" && (!scan || scan.status === "needs_setup");
  const noUrlNeeded = kind === "deps" || kind === "errors" || kind === "pentest_deep";
  const choose = kind === "conversion";
  const actionable = failed.filter((f) => !f.manual && f.severity !== "info");
  // Conversión: el usuario marca qué cambios aplicar (ninguno por defecto).
  const selectable = choose && scan?.status === "ok" && !repair?.open && actionable.length > 0;
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Solo cuenta lo elegido que sigue en el análisis actual: tras analizar de nuevo,
  // un id que ya no aparece no debe aplicarse ni descuadrar "Elegir todos".
  const chosen = actionable.filter((f) => picked.has(f.id)).map((f) => f.id);
  const allChosen = chosen.length === actionable.length;
  const [applyState, apply, applying] = useActionState<ActionState, FormData>(
    () => applyChosenAction(projectId, chosen),
    null,
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-6 p-6 md:flex-row md:items-center md:gap-8">
        {needsUrl ? (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-2">
            <Globe className="h-6 w-6" strokeWidth={1.75} />
          </span>
        ) : (
          <div className="flex w-40 shrink-0 flex-col gap-2.5">
            <p className="flex items-baseline gap-1">
              <span
                className={`text-[48px] font-semibold leading-none tracking-tight tabular ${score === null ? "text-fg-3" : toneText(score)}`}
              >
                {score ?? "—"}
              </span>
              <span className="text-[14px] text-fg-3">/100</span>
            </p>
            <span
              className={`meter ${score === null ? "" : toneText(score)}`}
              role="img"
              aria-label={score === null ? "Sin puntaje" : `${score} de 100`}
            >
              <span style={{ width: `${score ?? 0}%` }} />
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-semibold tracking-tight">
            {needsUrl ? `${copy.title} necesita la URL pública` : copy.title}
          </h2>
          <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-fg-2">
            {copy.what}
          </p>
          <p className="mt-3 text-[13px]">
            {scan ? (
              <>
                <span
                  className={
                    scan.status === "ok"
                      ? "font-medium"
                      : scan.status === "error"
                        ? "font-medium text-bad"
                        : "text-fg-2"
                  }
                >
                  {scan.summary}
                </span>
                <span className="text-fg-3">
                  {" · "}
                  <span suppressHydrationWarning>{timeAgo(scan.createdAt)}</span>
                </span>
                {running && typeof scan.meta.run === "string" && (
                  <a href={scan.meta.run} target="_blank" rel="noreferrer" className="ml-2 font-medium text-accent hover:underline">
                    Ver en GitHub Actions
                  </a>
                )}
              </>
            ) : (
              <span className="text-fg-3">Todavía no hay análisis.</span>
            )}
          </p>
        </div>
        <form
          action={run}
          className={`flex flex-col items-start gap-2 md:items-end ${needsSetup ? "hidden" : ""}`}
        >
          {needsUrl && (
            <Link
              href="?tab=ajustes"
              scroll={false}
              className="btn btn-primary"
            >
              <Settings />
              Configurar URL
            </Link>
          )}
          <button
            disabled={pending || running || (!appUrl && !noUrlNeeded)}
            className={`btn ${needsUrl ? "btn-outline btn-sm" : "btn-primary"}`}
          >
            {pending || running ? (
              <Loader2 className="animate-spin" />
            ) : scan ? (
              <RotateCw />
            ) : (
              <Play />
            )}
            {running
              ? "En curso"
              : pending
                ? kind === "deps" || kind === "errors"
                  ? "Revisando…"
                  : kind === "pentest_deep"
                    ? "Lanzando…"
                    : "Analizando…"
                : kind === "deps" || kind === "errors"
                  ? "Revisar ahora"
                  : kind === "pentest_deep"
                    ? "Correr ahora"
                    : scan
                      ? "Analizar de nuevo"
                      : "Analizar ahora"}
          </button>
          <span className="text-[12px] text-fg-3">
            {kind === "deps"
              ? `${typeof scan?.meta?.packages === "number" ? `${scan.meta.packages} paquetes · ` : ""}vigilancia cada 15 min`
              : kind === "errors"
                ? "Cada noche, 1:00 a. m. (Ciudad de México)"
                : kind === "pentest_deep"
                  ? "Cada semana · tarda unas horas"
                  : appUrl
                    ? `${appUrl.replace(/^https?:\/\//, "")} · cada noche · tarda ${copy.wait}`
                    : "Agrega la URL de producción en Ajustes"}
          </span>
        </form>
      </section>
      <Note state={state} />

      {kind === "pentest" && !verified && (
        <VerifyCallout projectId={projectId} />
      )}

      {needsSetup && <DeepSetup projectId={projectId} setup={scan?.meta} />}

      {scan?.status === "ok" && (!choose || repair?.open) && (
        <RepairSection projectId={projectId} kind={kind} repair={repair} pending={actionable.length} />
      )}

      {kind === "lighthouse" && scores && (
        <section className="card overflow-hidden">
          {(["movil", "escritorio"] as const).map((s) =>
            scores[s] ? (
              <div key={s} className="border-b border-line last:border-b-0">
                <p className="px-5 pt-4 text-[12px] font-medium uppercase tracking-[0.06em] text-fg-3">{s === "movil" ? "Móvil" : "Escritorio"}</p>
                <div className="grid grid-cols-2 md:grid-cols-4">
                  {LH_CATEGORIES.map(([k, label]) => {
                    const v = scores[s]![k] ?? null;
                    return (
                      <div key={k} className="flex flex-col gap-2.5 p-5">
                        <span className="text-[13px] text-fg-2">{label}</span>
                        <span className={`text-[28px] font-semibold leading-none tabular ${v === null ? "text-fg-3" : toneText(v)}`}>{v ?? "—"}</span>
                        <span className={`meter ${v === null ? "" : toneText(v)}`}>
                          <span style={{ width: `${v ?? 0}%` }} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null,
          )}
          {metrics && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line p-5 sm:grid-cols-3 lg:grid-cols-5">
              {LH_METRICS.map(([k, abbr, label]) => (
                <div key={k}>
                  <dt className="text-[12px] text-fg-3" title={`${label}, en móvil`}>
                    {abbr} · {label}
                  </dt>
                  <dd className="mt-0.5 text-[16px] font-medium tabular">
                    {metrics[k] ?? "—"}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      {scan?.status === "ok" && (
        <section className="card overflow-hidden">
          <div className="card-head">
            <p className="text-[14px] font-semibold">Hallazgos</p>
            <span className="badge bg-surface-2 text-fg-2 tabular">
              {failed.length}
            </span>
          </div>
          {failed.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-6 text-[14px] font-medium text-ok">
              <CircleCheck className="h-4 w-4" />
              {kind === "lighthouse" ? "Todas las categorías en 90 o más." : "No hay nada que reparar."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {failed.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-4"
                >
                  {selectable && (
                    <span className="sm:pt-0.5">
                      {actionable.includes(f) && (
                        <input
                          type="checkbox"
                          aria-label={`Aplicar: ${f.title}`}
                          checked={picked.has(f.id)}
                          onChange={() => toggle(f.id)}
                          className="h-4 w-4 accent-[var(--accent-solid)]"
                        />
                      )}
                    </span>
                  )}
                  <span className="sm:w-16 sm:shrink-0 sm:pt-px">
                    <span className={`badge ${SEVERITY[f.severity].cls}`}>
                      {SEVERITY[f.severity].label}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[14px] font-medium">{f.title}</span>
                      <FindingOwner finding={f} repairing={!!repair?.open} deps={kind === "deps"} choose={choose} />
                    </p>
                    <p className="mt-0.5 break-words text-[13px] leading-relaxed text-fg-2">
                      <Rich text={f.detail} />
                    </p>
                    {f.copy && <CopyDiff copy={f.copy} />}
                    {f.fix && !f.copy && (
                      <details className="group mt-2 text-[13px]">
                        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded font-medium text-fg-2 transition-colors hover:text-accent group-open:text-fg [&::-webkit-details-marker]:hidden">
                          <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                          {f.manual ? "Qué tienes que hacer" : "Qué cambia Fixie"}
                        </summary>
                        <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2.5 leading-relaxed text-fg-2">
                          <Rich text={f.fix} />
                        </p>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {selectable && (
            <form action={apply} className="sticky bottom-0 flex flex-col gap-3 border-t border-line bg-surface px-5 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium tabular">
                  {chosen.length === 0 ? "Elige qué cambios aplicar" : `${chosen.length} ${chosen.length === 1 ? "cambio elegido" : "cambios elegidos"}`}
                </p>
                <p className="mt-0.5 text-[13px] text-fg-2">Fixie los prueba en el entorno de pruebas antes de publicarlos. Lo que no marques no se toca.</p>
              </div>
              <button
                type="button"
                onClick={() => setPicked(allChosen ? new Set() : new Set(actionable.map((f) => f.id)))}
                className="btn btn-ghost btn-sm"
              >
                {allChosen ? "Quitar todos" : "Elegir todos"}
              </button>
              <button disabled={applying || chosen.length === 0} className="btn btn-primary">
                {applying ? <Loader2 className="animate-spin" /> : <Wrench />}
                {applying ? "Aplicando…" : "Aplicar cambios"}
              </button>
            </form>
          )}
          {selectable && applyState && (
            <div className="border-t border-line px-5 py-3">
              <Note state={applyState} />
            </div>
          )}
          {passed.length > 0 && (
            <details className="group border-t border-line">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[14px] font-medium text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                {passed.length} controles en orden
              </summary>
              <ul className="grid gap-x-6 gap-y-2 px-5 pb-5 text-[13px] text-fg-2 sm:grid-cols-2">
                {passed.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 truncate">
                    <Check
                      className="h-3.5 w-3.5 shrink-0 text-ok"
                      strokeWidth={2.5}
                    />
                    <span className="truncate">{f.title}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

function VerifyCallout({ projectId }: { projectId: string }) {
  const [state, verify, pending] = useActionState<ActionState, FormData>(
    verifyOwnershipAction.bind(null, projectId),
    null,
  );
  const snippet = `// src/app/api/autosana-verify/route.ts
export function GET() {
  return new Response("${projectId}");
}`;
  return (
    <section className="card flex flex-col gap-4 p-5 md:flex-row md:items-start md:gap-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-warn-bg text-warn">
        <ShieldAlert className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">Verifica que la app es tuya</p>
        <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-fg-2">
          Las pruebas activas (buscar .env, .git y mapas de código expuestos)
          solo corren en dominios verificados. Agrega esta ruta a tu app y
          publica:
        </p>
        <pre className="mt-3 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-fg-2">
          {snippet}
        </pre>
        <div className="mt-3 empty:hidden">
          <Note state={state} />
        </div>
      </div>
      <form action={verify}>
        <button disabled={pending} className="btn btn-outline btn-sm">
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "Verificando…" : "Verificar"}
        </button>
      </form>
    </section>
  );
}

/** Texto actual y propuesto de una sugerencia de conversión. */
function CopyDiff({ copy }: { copy: { from: string; to: string } }) {
  return (
    <div className="mt-2 grid gap-px overflow-hidden rounded-lg border border-line bg-line text-[13px] sm:grid-cols-2">
      <div className="bg-surface-2 px-3 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-3">Ahora</p>
        <p className="mt-1 leading-relaxed text-fg-2">{copy.from}</p>
      </div>
      <div className="bg-surface px-3 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-accent">Propuesta</p>
        <p className="mt-1 leading-relaxed text-fg">{copy.to}</p>
      </div>
    </div>
  );
}

/**
 * Activar el pentest profundo: la clave del modelo se guarda cifrada como
 * secreto del repo en GitHub (Fixie no la guarda) y se instala el workflow.
 */
function DeepSetup({ projectId, setup }: { projectId: string; setup?: Record<string, unknown> }) {
  const [state, enable, pending] = useActionState<ActionState, FormData>(enableDeepAction.bind(null, projectId), null);
  const saved = shannonModel(typeof setup?.model === "string" ? setup.model : null);
  const [modelId, setModelId] = useState<ShannonModelId>(saved?.id ?? DEFAULT_SHANNON_MODEL);
  const model = shannonModel(modelId) ?? SHANNON_MODELS[0];
  const keySaved = setup?.secret === true && saved?.id === modelId;
  return (
    <section className="card flex flex-col gap-5 p-5 md:flex-row md:gap-8">
      <div className="md:w-[38%] md:shrink-0">
        <p className="text-[14px] font-semibold">{setup?.outdated ? "Actualizar el pentest profundo" : "Activar el pentest profundo"}</p>
        <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-4 text-[13px] leading-relaxed text-fg-2">
          <li>Fixie instala un workflow en tu repo con un PR.</li>
          <li>La clave del modelo se guarda cifrada como secreto de GitHub. Fixie no la guarda.</li>
          <li>
            Cada semana, Fixie arma solo un entorno de pruebas dentro de GitHub Actions: una copia de tu app con una base desechable (la estructura de la tuya, sin ningún dato),
            variables generadas y, si usas Supabase, una cuenta de prueba.
          </li>
          <li>Shannon ataca esa copia, nunca producción, y Fixie repara lo que logre explotar.</li>
        </ol>
        <p className="mt-3 text-[12px] leading-relaxed text-fg-3">
          La corrida se cobra en tu cuenta del proveedor de IA, no en tus créditos de Fixie. Tarda de una a varias horas y necesita un repo privado.
        </p>
      </div>
      <form onSubmit={keepFields(enable)} className="flex min-w-0 flex-1 flex-col gap-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] font-medium">Modelo</legend>
          <input type="hidden" name="model" value={model.id} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
            {SHANNON_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={m.id === model.id}
                onClick={() => setModelId(m.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${m.id === model.id ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`}
              >
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  {m.label}
                  {m.id === DEFAULT_SHANNON_MODEL && <span className="badge bg-surface-2 text-fg-2">Recomendado</span>}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-fg-3">{m.note}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Clave de {model.label.replace(/ \(.*\)$/, "")}</span>
          <input name="apiKey" type="password" autoComplete="off" spellCheck={false} placeholder={keySaved ? "Guardada en tu repo" : model.keyHint} className="input font-mono" />
          <span className="text-[12px] text-fg-3">{keySaved ? "Ya está guardada. Déjalo vacío para conservarla." : "Se guarda solo en tu repo, cifrada."}</span>
        </label>
        <details className="group rounded-lg border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-[13px] text-fg-2 [&::-webkit-details-marker]:hidden">
            Claves de prueba de servicios externos (opcional)
            <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
          </summary>
          <label className="flex flex-col gap-1.5 border-t border-line p-3">
            <span className="text-[12px] text-fg-3">
              Fixie ya arma la base y las variables. Solo si quieres que Shannon pruebe también pagos o correos, pega sus claves de prueba.
            </span>
            <textarea
              name="testEnv"
              rows={2}
              spellCheck={false}
              placeholder={"STRIPE_SECRET_KEY=sk_test_…"}
              className="input min-h-[64px] py-2 font-mono text-[12px]"
            />
            <span className="text-[12px] text-fg-3">Fixie rechaza las que apunten a producción.</span>
          </label>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending} className="btn btn-primary">
            {pending ? <Loader2 className="animate-spin" /> : <ShieldAlert />}
            {pending ? "Activando…" : "Activar"}
          </button>
        </div>
        <Note state={state} />
      </form>
    </section>
  );
}

/** Quién resuelve el hallazgo: Fixie con un PR, tú (hosting, DNS, secretos) o tu decisión (textos). */
function FindingOwner({ finding, repairing, deps, choose }: { finding: Finding; repairing: boolean; deps: boolean; choose?: boolean }) {
  if (finding.severity === "info") return null;
  if (choose && !finding.manual && !repairing)
    return (
      <span className="flex items-center gap-1 text-[12px] text-fg-3">
        <UserRound className="h-3.5 w-3.5" />
        Tú decides
      </span>
    );
  if (finding.manual)
    return (
      <span className="flex items-center gap-1 text-[12px] text-fg-3">
        <UserRound className="h-3.5 w-3.5" />
        {deps ? "Sin parche todavía: Fixie actualiza en cuanto salga" : "Requiere tu acción"}
      </span>
    );
  return (
    <span className={`flex items-center gap-1 text-[12px] ${repairing ? "text-accent" : "text-fg-3"}`}>
      {repairing ? <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : <Wrench className="h-3.5 w-3.5" />}
      {repairing ? "Fixie lo está reparando" : "Fixie lo repara"}
    </span>
  );
}

/**
 * Reparación automática: tras cada análisis Fixie abre una reparación con lo
 * que se arregla con código. Aquí se ve en vivo (o una simulación del ciclo).
 */
function RepairSection({ projectId, kind, repair, pending }: { projectId: string; kind: ScanKind; repair: RepairSummary | null; pending: number }) {
  const [state, repairNow, starting] = useActionState<ActionState, FormData>(repairNowAction.bind(null, projectId, kind), null);
  const [simAt, setSimAt] = useState<number | null>(null);

  const head = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-[16px] font-semibold tracking-tight">Reparación automática</h3>
        <p className="mt-0.5 text-[13px] text-fg-2">
          Fixie reproduce cada hallazgo con una prueba, lo repara, el revisor intenta romperlo y, tras el merge, vuelve a analizar producción.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* Sin esto, tras ver la simulación no había forma de volver a la reparación real sin recargar. */}
        {simAt && repair && (
          <button type="button" onClick={() => setSimAt(null)} className="btn btn-ghost btn-sm">
            <Wrench />
            Ver la reparación real
          </button>
        )}
        <button type="button" onClick={() => setSimAt(Date.now())} className="btn btn-ghost btn-sm">
          <Play />
          {simAt ? "Repetir simulación" : "Ver simulación"}
        </button>
      </div>
    </div>
  );

  if (simAt) {
    return (
      <section className="flex flex-col gap-4">
        {head}
        <IncidentView key={`sim-${simAt}`} source={{ kind: "sim-repair", repair: kind, startedAt: simAt }} />
      </section>
    );
  }

  if (repair) {
    return (
      <section className="flex flex-col gap-4">
        {head}
        <IncidentView key={repair.number} source={{ kind: "live", projectId, number: repair.number }} />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {head}
      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Wrench className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">
            {pending > 0 ? `${pending} ${pending === 1 ? "hallazgo listo" : "hallazgos listos"} para reparar` : "Nada que reparar"}
          </p>
          <p className="mt-0.5 text-[13px] text-fg-2">
            {pending > 0 ? "La reparación arranca sola después de cada análisis. Puedes empezarla ya." : "Cada análisis nuevo vuelve a revisar y repara lo que encuentre."}
          </p>
        </div>
        {pending > 0 && (
          <form action={repairNow}>
            <button disabled={starting} className="btn btn-primary">
              {starting ? <Loader2 className="animate-spin" /> : <Wrench />}
              {starting ? "Empezando…" : "Reparar ahora"}
            </button>
          </form>
        )}
      </div>
      <Note state={state} />
    </section>
  );
}
