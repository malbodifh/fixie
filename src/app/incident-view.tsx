"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleCheck,
  Database,
  DatabaseBackup,
  ExternalLink,
  FileText,
  FlaskConical,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  CircleHelp,
  Lightbulb,
  PauseCircle,
  PlayCircle,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { retryIncidentAction } from "./proyectos/actions";
import { currentAttempt, deriveStage, MAX_ROUNDS, REPAIR_LABEL, type Stage, type Step } from "@/lib/model";
import { Mascot, type MascotMode } from "./mascot";
import { clock, timeAgo } from "./time";
import { TERMINAL, useIncident, type IncidentSource } from "./use-incident";

const STAGES: { id: Stage; label: string; verb: string }[] = [
  { id: "detectado", label: "Detectado", verb: "Recibiendo el error" },
  { id: "diagnosticando", label: "Diagnóstico", verb: "Buscando la causa" },
  { id: "reproduciendo", label: "Reproducir", verb: "Reproduciendo en CI" },
  { id: "arreglando", label: "Arreglo", verb: "Escribiendo el arreglo" },
  { id: "revisando", label: "Revisión", verb: "El revisor intenta romperlo" },
  { id: "desplegando", label: "Despliegue", verb: "Publicando en producción" },
  { id: "verificado", label: "Verificado", verb: "Verificado" },
];

type Tone = "ok" | "bad" | "warn" | "accent" | "muted";

const STEP: Record<Step["kind"], { icon: LucideIcon; tone: Tone }> = {
  detected: { icon: AlertTriangle, tone: "bad" },
  recurred: { icon: RotateCw, tone: "warn" },
  diagnosing: { icon: Search, tone: "muted" },
  reading: { icon: FileText, tone: "muted" },
  db_query: { icon: Database, tone: "muted" },
  diagnosis: { icon: Lightbulb, tone: "accent" },
  db_tested: { icon: Database, tone: "muted" },
  pr_opened: { icon: GitPullRequest, tone: "accent" },
  reproduced: { icon: FlaskConical, tone: "bad" },
  not_reproduced: { icon: CircleHelp, tone: "warn" },
  ci_passed: { icon: CircleCheck, tone: "ok" },
  ci_failed: { icon: XCircle, tone: "bad" },
  fixing: { icon: Wrench, tone: "warn" },
  fix_pushed: { icon: GitCommitHorizontal, tone: "accent" },
  review_started: { icon: ShieldCheck, tone: "accent" },
  review_pushed: { icon: ShieldCheck, tone: "accent" },
  review_failed: { icon: ShieldAlert, tone: "warn" },
  review_passed: { icon: ShieldCheck, tone: "ok" },
  db_backup: { icon: DatabaseBackup, tone: "muted" },
  db_applied: { icon: Database, tone: "ok" },
  needs_review: { icon: UserRound, tone: "warn" },
  merged: { icon: GitMerge, tone: "accent" },
  verified: { icon: CircleCheck, tone: "ok" },
  failed: { icon: XCircle, tone: "bad" },
  paused: { icon: PauseCircle, tone: "warn" },
  resumed: { icon: PlayCircle, tone: "accent" },
  retried: { icon: RotateCw, tone: "accent" },
};

const TONE: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  bad: "bg-bad-bg text-bad",
  warn: "bg-warn-bg text-warn",
  accent: "bg-accent-soft text-accent",
  muted: "bg-surface-2 text-fg-3",
};

const REVIEW_STEPS = new Set<Step["kind"]>(["review_started", "review_pushed", "review_failed", "review_passed"]);

/** Quita el marcado mínimo de Markdown que usa el agente. */
function plain(text: string): string {
  return text.replace(/\*\*/g, "").replace(/`/g, "");
}

export function IncidentView({ source }: { source: IncidentSource }) {
  const { data, error, reload } = useIncident(source);
  const [now, setNow] = useState(() => Date.now());
  const [retrying, startRetry] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);
  // Pasos que tenía el incidente al pedir el reintento: el botón sigue bloqueado
  // hasta que la consulta traiga el reintento, para no lanzarlo dos veces.
  const [retriedAt, setRetriedAt] = useState<number | null>(null);

  const stage = data?.incident.stage;
  useEffect(() => {
    if (!stage || TERMINAL.includes(stage)) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [stage]);

  if (!data) {
    return error ? (
      <div className="card p-6 text-[14px] text-bad">{error}</div>
    ) : (
      <div className="card flex flex-col gap-4 p-6" aria-label="Cargando incidente">
        <span className="skeleton h-5 w-1/3" />
        <span className="skeleton h-7 w-3/4" />
        <span className="skeleton h-16" />
      </div>
    );
  }

  const { incident, diff } = data;
  const p = incident.payload;
  const r = incident.repair;
  const verified = incident.stage === "verificado";
  const failed = incident.stage === "fallido";
  const review = incident.stage === "revision";
  const paused = incident.stage === "pausado";
  const working = !TERMINAL.includes(incident.stage);

  // Tras un reintento, lo anterior es historia: el estado y el tiempo cuentan desde ahí.
  const attempt = currentAttempt(incident.steps);
  const startedAt = attempt[0]?.kind === "retried" ? attempt[0].at : incident.createdAt;
  const verifiedAt = attempt.find((s) => s.kind === "verified")?.at;
  const lastAt = incident.steps.at(-1)?.at ?? incident.createdAt;
  const end = verifiedAt ? Date.parse(verifiedAt) : working ? now : Date.parse(lastAt);
  const pauseNote = paused ? incident.steps.at(-1) : undefined;
  const elapsed = end - Date.parse(startedAt);
  // En pausa, las etapas muestran dónde se quedó el trabajo.
  const stageIndex = STAGES.findIndex((s) => s.id === (paused ? deriveStage(attempt.slice(0, -1)) : incident.stage));
  const diagnosis = attempt.find((s) => s.kind === "diagnosis");
  const failNote = [...attempt].reverse().find((s) => s.kind === "failed");
  const reviewNote = [...attempt].reverse().find((s) => s.kind === "needs_review" || s.kind === "not_reproduced");
  const fixieMode: MascotMode = verified ? "happy" : failed || review ? "sad" : paused ? "idle" : incident.stage === "revisando" ? "reviewing" : working ? "typing" : "idle";
  const finalScore = attempt.find((s) => s.kind === "verified" || s.kind === "needs_review")?.data.score;
  const canRetry = source.kind === "live" && (failed || review || paused);
  const awaitingRetry = retrying || retriedAt === incident.steps.length;
  const retry = () => {
    if (source.kind !== "live" || awaitingRetry) return;
    setRetryError(null);
    const steps = incident.steps.length;
    startRetry(async () => {
      const res = await retryIncidentAction(source.projectId, source.number);
      if (res?.error) setRetryError(res.error);
      else {
        setRetriedAt(steps);
        reload();
      }
    });
  };
  const prUrl = incident.pr && source.kind === "live" ? incident.url.replace(/\/issues\/\d+$/, `/pull/${incident.pr}`) : null;

  const status = verified
    ? { text: r ? "Reparado" : "Arreglado", cls: "bg-ok-bg text-ok" }
    : failed
      ? { text: "Detenido", cls: "bg-bad-bg text-bad" }
      : review
        ? { text: "Espera revisión", cls: "bg-warn-bg text-warn" }
        : paused
          ? { text: "En pausa", cls: "bg-warn-bg text-warn" }
        : { text: STAGES[stageIndex]?.verb ?? "Trabajando", cls: "bg-accent-soft text-accent" };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Encabezado */}
      <section className="card overflow-hidden">
        <div className="flex flex-col gap-6 p-5 md:flex-row md:items-start md:justify-between md:p-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${status.cls}`}>
                {working && <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
                {verified && <Check strokeWidth={2.5} />}
                {status.text}
              </span>
              {incident.round > 1 && (
                <span className="badge bg-warn-bg text-warn tabular">
                  Ronda {incident.round} de {MAX_ROUNDS}
                </span>
              )}
              {r ? (
                <span className="text-[13px] text-fg-3">#{incident.number} · Reparación automática de {REPAIR_LABEL[r.kind]}</span>
              ) : (
                <span className="text-[13px] text-fg-3">
                  #{incident.number} · {p ? `${p.request.method} ${p.request.path}` : "—"} · {incident.occurrences}{" "}
                  {incident.occurrences === 1 ? "vez" : "veces"}
                </span>
              )}
            </div>
            {r ? (
              <>
                <h2 className="mt-3 text-[17px] font-semibold tracking-tight">
                  Reparar {r.findings.length} {r.findings.length === 1 ? "hallazgo" : "hallazgos"} de {REPAIR_LABEL[r.kind]}
                </h2>
                <p className="mt-1 line-clamp-2 text-[13px] text-fg-2">{r.findings.map((f) => f.title).join(" · ")}</p>
              </>
            ) : (
              <>
                <h2 className="mt-3 break-words font-mono text-[15px] font-medium leading-snug text-bad md:text-[16px]">
                  {p ? `${p.name}: ${p.message}` : incident.title}
                </h2>
                {p?.stack && <p className="mt-1.5 truncate font-mono text-[12px] text-fg-3">{p.stack.split("\n")[1]?.trim()}</p>}
              </>
            )}
          </div>
          <div className="shrink-0 md:text-right">
            <p className="text-[13px] text-fg-3">{verified ? (r ? "Reparado en" : "Arreglado en") : failed || review || paused ? "Se detuvo tras" : "Tiempo"}</p>
            <p className={`text-[40px] font-semibold leading-none tracking-tight tabular ${verified ? "text-ok" : ""}`}>{clock(elapsed)}</p>
            {r && finalScore !== undefined && (
              <p className="mt-2 text-[13px] text-fg-2 tabular">
                Puntaje {r.scoreBefore ?? "—"} <ArrowRight className="inline h-3 w-3 text-fg-3" aria-label="a" /> <span className="font-semibold text-ok">{finalScore}</span>
              </p>
            )}
            {canRetry && (
              <div className="mt-4 flex flex-col gap-2 md:items-end">
                <button type="button" onClick={retry} disabled={awaitingRetry} className="btn btn-primary">
                  <Wrench />
                  {awaitingRetry ? "Empezando…" : "Diagnosticar y reparar"}
                </button>
                {retryError && <p className="max-w-xs text-[13px] text-bad md:text-right" role="alert">{retryError}</p>}
              </div>
            )}
          </div>
        </div>

        {/* Etapas */}
        <ol className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:grid sm:grid-cols-7 sm:gap-0 sm:px-3 md:px-5" aria-label="Etapas">
          {STAGES.map((s, i) => {
            const done = !failed && !review && (i < stageIndex || verified);
            const current = paused && i === stageIndex;
            const active = working && i === stageIndex;
            return (
              <li key={s.id} className="relative flex items-center gap-3 sm:flex-col sm:gap-2 sm:text-center" aria-current={active ? "step" : undefined}>
                {i > 0 && (
                  <span
                    className={`absolute left-[-50%] right-1/2 top-[11px] hidden h-px sm:block ${done || active ? "bg-accent" : "bg-line"}`}
                    aria-hidden
                  />
                )}
                <span
                  className={`relative grid h-[23px] w-[23px] place-items-center rounded-full text-[11px] font-medium tabular transition-colors ${
                    done ? "bg-accent-solid text-accent-fg" : active ? "border-2 border-accent bg-surface text-accent" : current ? "border-2 border-warn bg-surface text-warn" : "border border-line-2 bg-surface text-fg-3"
                  }`}
                >
                  {done ? <Check className="h-3 w-3" strokeWidth={3} /> : active ? <span className="live-dot h-2 w-2 rounded-full bg-accent" /> : current ? <PauseCircle className="h-3 w-3" strokeWidth={2.5} /> : i + 1}
                </span>
                <span className={`text-[13px] leading-tight sm:text-[12px] ${active || current ? "font-medium text-fg" : done ? "text-fg-2" : "text-fg-3"}`}>{s.label}</span>
              </li>
            );
          })}
        </ol>

        {verified && (
          <p className="flex items-center gap-2 border-t border-line bg-ok-bg px-5 py-3 text-[14px] font-medium text-ok md:px-6">
            <CircleCheck className="h-4 w-4 shrink-0" />
            {r
              ? "Reproducido, reparado, atacado por el revisor y re-analizado en producción. Nadie tuvo que tocar el código."
              : "Reproducido, arreglado, revisado y verificado en producción. Nadie tuvo que despertarse."}
          </p>
        )}
        {failed && (
          <p className="flex items-center gap-2 border-t border-line bg-bad-bg px-5 py-3 text-[14px] font-medium text-bad md:px-6">
            <XCircle className="h-4 w-4 shrink-0" />
            {failNote ? `Fixie se detuvo: ${plain(failNote.text).split("\n")[0]}` : "Fixie se detuvo de forma segura antes de tocar tu código."}
          </p>
        )}
        {paused && (
          <div className="flex flex-col gap-2 border-t border-line bg-warn-bg px-5 py-3 text-[14px] text-warn sm:flex-row sm:items-center sm:justify-between md:px-6">
            <p className="flex items-center gap-2 font-medium">
              <PauseCircle className="h-4 w-4 shrink-0" />
              {pauseNote ? plain(pauseNote.text) : "En pausa por el límite de consumo de tu plan."}
            </p>
            <Link href="/uso" className="shrink-0 text-[13px] font-medium underline underline-offset-2">
              Ver mi consumo
            </Link>
          </div>
        )}
        {review && (
          <p className="flex items-center gap-2 border-t border-line bg-warn-bg px-5 py-3 text-[14px] font-medium text-warn md:px-6">
            <UserRound className="h-4 w-4 shrink-0" />
            {reviewNote ? plain(reviewNote.text) : "El arreglo espera tu revisión."}
          </p>
        )}
      </section>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* Actividad */}
        <section className="card self-start overflow-hidden">
          <div className="card-head">
            <p className="text-[14px] font-semibold">Actividad</p>
            <Mascot mode={fixieMode} size={36} />
          </div>
          <ol className="flex flex-col p-5">
            {incident.steps.map((s, i) => {
              const { icon: Icon, tone } = STEP[s.kind];
              const last = i === incident.steps.length - 1;
              return (
                <li key={`${s.at}-${i}`} className="step-in relative flex gap-3 pb-5 last:pb-0">
                  {!last && <span className="absolute bottom-0 left-[13px] top-8 w-px bg-line" aria-hidden />}
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${TONE[tone]}`} aria-hidden>
                    <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{plain(s.text)}</p>
                    <p className="mt-0.5 text-[12px] text-fg-3">
                      {REVIEW_STEPS.has(s.kind) ? "Revisor" : "Fixie"} · {timeAgo(s.at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* El arreglo */}
        <section className="card min-w-0 self-start overflow-hidden">
          <div className="card-head">
            <p className="text-[14px] font-semibold">{r ? "La reparación" : "El arreglo"}</p>
            {incident.pr &&
              (prUrl ? (
                <a href={prUrl} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                  PR #{incident.pr}
                  <ExternalLink />
                </a>
              ) : (
                <span className="badge bg-surface-2 text-fg-2">PR #{incident.pr}</span>
              ))}
          </div>
          <div className="flex flex-col gap-4 p-5">
            {diagnosis ? (
              <div className="step-in text-[14px] leading-relaxed">
                {plain(diagnosis.text)
                  .split("\n\n")
                  .map((para, i) => (
                    <p key={i} className="[&:not(:first-child)]:mt-2">
                      {para}
                    </p>
                  ))}
              </div>
            ) : paused || failed || review ? (
              <p className="text-[14px] text-fg-3">
                {paused ? "En pausa. Fixie busca la causa en cuanto se renueven tus créditos." : "Fixie no llegó a un diagnóstico."}
              </p>
            ) : (
              <div className="flex flex-col gap-2" aria-label="Fixie busca la causa">
                <span className="skeleton h-4 w-5/6" />
                <span className="skeleton h-4 w-2/3" />
                <p className="mt-1 text-[13px] text-fg-3">{r ? "Fixie está leyendo el código para repararlo." : "Fixie todavía está buscando la causa."}</p>
              </div>
            )}

            {diff.map((f) => (
              <div key={f.filename} className="step-in overflow-hidden rounded-lg border border-line">
                <p className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-3 py-2 text-[12px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono font-medium">{f.filename}</span>
                    {f.filename.includes("autosana-revision") && <span className="badge bg-accent-soft text-accent">Revisor</span>}
                  </span>
                  <span className="shrink-0 font-mono tabular">
                    <span className="text-ok">+{f.additions}</span> <span className="text-bad">−{f.deletions}</span>
                  </span>
                </p>
                <pre className="max-h-80 overflow-auto bg-surface font-mono text-[12px] leading-5">
                  {(f.patch ?? "").split("\n").map((line, i) => (
                    <div
                      key={i}
                      className={`px-3 ${
                        line.startsWith("+") ? "bg-add-bg" : line.startsWith("-") ? "bg-del-bg" : line.startsWith("@@") ? "bg-accent-soft text-fg-3" : "text-fg-2"
                      }`}
                    >
                      {line || " "}
                    </div>
                  ))}
                </pre>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
