"use client";

import { CircleAlert, CircleCheck, DatabaseBackup, Download, KeyRound, Loader2, Unlink } from "lucide-react";
import { useActionState } from "react";
import { timeAgo } from "../../time";
import {
  backupNowAction,
  linkDatabaseAction,
  rotateKeyAction,
  unlinkDatabaseAction,
  updateSettingsAction,
  type ActionState,
} from "../actions";
import { DbRoleHelp, KeyReveal } from "../ui";

export function Note({ state }: { state: ActionState }) {
  if (state?.error)
    return (
      <p role="alert" className="flex items-start gap-2 rounded-lg bg-bad-bg px-3 py-2.5 text-[13px] text-bad">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        {state.error}
      </p>
    );
  if (state?.message)
    return (
      <p role="status" className="flex items-start gap-2 rounded-lg bg-ok-bg px-3 py-2.5 text-[13px] text-ok">
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
        {state.message}
      </p>
    );
  return null;
}

function Head({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[13px] text-fg-2">{text}</p>
      </div>
      {children}
    </div>
  );
}

export function SettingsPanel({ projectId, name, appUrl, autoMerge }: { projectId: string; name: string; appUrl: string | null; autoMerge: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateSettingsAction.bind(null, projectId), null);
  return (
    <section className="card overflow-hidden">
      <Head title="Conexiones" text="Nombre del proyecto y dónde vive tu app." />
      <form action={action} className="flex flex-col gap-5 p-5">
        <label className="flex flex-col gap-1.5">
          <span className="label">Nombre</span>
          <input name="name" defaultValue={name} maxLength={60} className="input" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">URL de producción</span>
          <input name="appUrl" type="url" defaultValue={appUrl ?? ""} placeholder="https://mi-app.vercel.app" className="input" />
          <span className="text-[12px] text-fg-3">Fixie confirma cada despliegue con GET /api/version.</span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 transition-colors hover:bg-surface-2">
          <input name="autoMerge" type="checkbox" defaultChecked={autoMerge} className="mt-0.5 h-4 w-4 accent-[var(--accent-solid)]" />
          <span className="text-[13px] text-fg-2">
            <span className="block text-[14px] font-medium text-fg">Merge automático</span>
            Solo si el revisor no logra volver a romper el arreglo.
          </span>
        </label>
        <Note state={state} />
        <div>
          <button disabled={pending} className="btn btn-primary btn-sm">
            {pending && <Loader2 className="animate-spin" />}
            {pending ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </section>
  );
}

type BackupView = { id: string; reason: string; tables: number; rows: number; bytes: number; createdAt: string; incident: number | null };

const REASON: Record<string, string> = { semanal: "Semanal", antes_de_cambio: "Antes de un cambio", manual: "Manual" };

export function DatabasePanel({ projectId, label, backups }: { projectId: string; label: string | null; backups: BackupView[] }) {
  const [linkState, link, linking] = useActionState<ActionState, FormData>(linkDatabaseAction.bind(null, projectId), null);
  const [backupState, backup, backingUp] = useActionState<ActionState, FormData>(backupNowAction.bind(null, projectId), null);
  const [unlinkState, unlink, unlinking] = useActionState<ActionState, FormData>(unlinkDatabaseAction.bind(null, projectId), null);

  return (
    <section className="card overflow-hidden">
      <Head title="Base de datos" text="Fixie lee para diagnosticar y nunca borra ni cambia tus datos.">
        {label && (
          <span className="badge bg-ok-bg text-ok">
            <CircleCheck />
            Conectada
          </span>
        )}
      </Head>
      <div className="flex flex-col gap-5 p-5">
        {label ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 truncate font-mono text-[13px] text-fg-2">{label}</p>
              <div className="flex flex-wrap gap-2">
                <form action={backup}>
                  <button disabled={backingUp} className="btn btn-primary btn-sm">
                    {backingUp ? <Loader2 className="animate-spin" /> : <DatabaseBackup />}
                    {backingUp ? "Respaldando…" : "Respaldar ahora"}
                  </button>
                </form>
                <form
                  action={unlink}
                  onSubmit={(e) => {
                    if (!confirm("Fixie dejará de leer esta base de datos. Tus respaldos se conservan. ¿Desvincular?")) e.preventDefault();
                  }}
                >
                  <button disabled={unlinking} className="btn btn-outline btn-sm">
                    <Unlink />
                    Desvincular
                  </button>
                </form>
              </div>
            </div>
            <Note state={backupState ?? unlinkState} />
            <div>
              <p className="label mb-2">Respaldos</p>
              {backups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line-2 px-4 py-5 text-center text-[13px] text-fg-3">
                  Todavía no hay respaldos. Se crea uno cada semana y antes de cualquier cambio.
                </p>
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                  {backups.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0">
                        <span className="text-[14px] font-medium">{REASON[b.reason] ?? b.reason}</span>
                        {b.incident && <span className="text-[13px] text-fg-3"> · incidente #{b.incident}</span>}
                        <span className="block text-[12px] text-fg-3 tabular" suppressHydrationWarning>
                          {b.tables} tablas · {b.rows} filas · {timeAgo(b.createdAt)}
                        </span>
                      </span>
                      <a href={`/api/projects/${projectId}/backups/${b.id}`} className="btn btn-ghost btn-sm">
                        <Download />
                        Descargar
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <form action={link} className="flex flex-col gap-3">
            <p className="max-w-[70ch] text-[13px] text-fg-2">
              Vincúlala para que Fixie pueda leer datos al diagnosticar y proponer estructura nueva cuando un arreglo la necesite.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input name="dbUrl" type="password" required autoComplete="off" placeholder="postgresql://fixie:…@host:5432/postgres" className="input font-mono text-[13px]" />
              <button disabled={linking} className="btn btn-primary shrink-0">
                {linking && <Loader2 className="animate-spin" />}
                {linking ? "Probando conexión…" : "Vincular"}
              </button>
            </div>
            <Note state={linkState} />
          </form>
        )}
        <DbRoleHelp />
      </div>
    </section>
  );
}

export function InstallPanel({ projectId, baseUrl, keyHint, snippet }: { projectId: string; baseUrl: string; keyHint: string; snippet: string }) {
  const [state, rotate, rotating] = useActionState<ActionState, FormData>(rotateKeyAction.bind(null, projectId), null);
  return (
    <section className="card min-w-0 overflow-hidden">
      <Head title="Instalación" text="La clave con la que tu app le avisa a Fixie de cada error." />
      <div className="flex flex-col gap-4 p-5">
        {state?.key ? (
          <KeyReveal baseUrl={baseUrl} ingestKey={state.key} />
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
            <span className="flex min-w-0 items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-fg-3" />
              <span className="truncate font-mono text-[13px]">{keyHint}</span>
            </span>
            <form
              action={rotate}
              onSubmit={(e) => {
                if (!confirm("La clave actual dejará de funcionar. ¿Generar una nueva?")) e.preventDefault();
              }}
            >
              <button disabled={rotating} className="btn btn-ghost btn-sm">
                {rotating && <Loader2 className="animate-spin" />}
                {rotating ? "Generando…" : "Generar nueva"}
              </button>
            </form>
          </div>
        )}
        <div className="overflow-hidden rounded-lg border border-line">
          <p className="border-b border-line bg-surface-2 px-3 py-2 font-mono text-[12px] text-fg-3">src/instrumentation.ts</p>
          <pre className="overflow-x-auto p-3 pb-4 font-mono text-[12px] leading-relaxed text-fg-2">{snippet.replace(/^\/\/ src\/instrumentation\.ts\n/, "")}</pre>
        </div>
      </div>
    </section>
  );
}
