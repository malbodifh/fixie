"use client";

import { ArrowRight, CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { createProjectAction, type ActionState } from "../actions";
import { DbRoleHelp, keepFields, KeyReveal } from "../ui";

export function NewProjectForm({ repos, baseUrl }: { repos: string[]; baseUrl: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createProjectAction, null);
  const [repo, setRepo] = useState("");

  if (state?.ok && state.key && state.id) {
    return (
      <div className="card flex flex-col gap-5 p-6">
        <div className="flex items-start gap-3">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
          <div>
            <p className="text-[16px] font-semibold">Proyecto creado</p>
            <p className="mt-0.5 text-[14px] text-fg-2">Agrega estas variables a tu app (en Vercel: Settings, Environment Variables).</p>
          </div>
        </div>
        <KeyReveal baseUrl={baseUrl} ingestKey={state.key} />
        <div>
          <Link href={`/proyectos/${state.id}`} className="btn btn-primary">
            Ir al proyecto
            <ArrowRight />
          </Link>
        </div>
      </div>
    );
  }

  return (
    // keepFields: si la acción devuelve un error, los campos conservan lo escrito.
    <form onSubmit={keepFields(action)} className="card flex flex-col gap-6 p-6">
      <Field label="Nombre" hint="Cómo lo verás en tu panel." htmlFor="name">
        <input id="name" name="name" aria-describedby="name-hint" required maxLength={60} placeholder="DevShop" className="input" />
      </Field>

      <Field label="Repositorio de GitHub" hint="Ahí se abren los incidentes, las ramas y los PRs." htmlFor="repo">
        <input
          id="repo"
          name="repo"
          aria-describedby="repo-hint"
          required
          list="repos"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder={repos[0] ?? "usuario/repo"}
          autoComplete="off"
          className="input font-mono text-[13px]"
        />
        <datalist id="repos">
          {repos.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        {repos.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {repos.slice(0, 6).map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => setRepo(r)}
                aria-pressed={repo === r}
                className={`rounded-md border px-2 py-1 font-mono text-[12px] transition-colors ${
                  repo === r ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-2 hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </Field>

      <Field label="URL de producción" hint="Opcional. Para confirmar que el arreglo llegó (GET /api/version) y para el código QR." htmlFor="appUrl">
        <input id="appUrl" name="appUrl" aria-describedby="appUrl-hint" type="url" placeholder="https://mi-app.vercel.app" className="input" />
      </Field>

      <Field label="Base de datos" hint="Opcional. URL de Postgres. Se guarda cifrada y se prueba antes de guardarla." htmlFor="dbUrl">
        <input id="dbUrl" name="dbUrl" aria-describedby="dbUrl-hint" type="password" autoComplete="off" placeholder="postgresql://fixie:…@host:5432/postgres" className="input font-mono text-[13px]" />
        <DbRoleHelp />
      </Field>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-4 transition-colors hover:bg-surface-2">
        <input name="autoMerge" type="checkbox" defaultChecked className="mt-0.5 h-4 w-4 accent-[var(--accent-solid)]" />
        <span>
          <span className="block text-[14px] font-medium">Merge automático</span>
          <span className="mt-0.5 block text-[13px] text-fg-2">Solo cuando el revisor no logra volver a romper el arreglo. Si lo desactivas, el PR espera tu aprobación.</span>
        </span>
      </label>

      {state?.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-bad-bg px-3 py-2.5 text-[13px] text-bad">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </p>
      )}

      <div className="border-t border-line pt-5">
        <button disabled={pending} className="btn btn-primary">
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "Creando y probando conexiones…" : "Crear proyecto"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-[14px] font-medium">
        {label}
      </label>
      {children}
      <span id={`${htmlFor}-hint`} className="text-[12px] text-fg-3">
        {hint}
      </span>
    </div>
  );
}
