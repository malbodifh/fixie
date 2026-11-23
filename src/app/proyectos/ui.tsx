"use client";

import { Check, ChevronRight, CircleAlert, CircleCheck, Copy, Lock, TriangleAlert } from "lucide-react";
import { startTransition, useState, type FormEvent } from "react";
import type { ActionState } from "./actions";

/** Resultado de una acción del servidor: error en rojo o confirmación en verde. */
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

/**
 * onSubmit que manda el formulario a la acción sin que React lo vacíe. Con
 * `action={fn}`, React borra los campos al terminar aunque la acción devuelva un
 * error, y la persona pierde lo que escribió.
 */
export function keepFields(dispatch: (form: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(form));
  };
}

/** Variables de entorno para la app monitoreada. La clave se muestra una sola vez. */
export function KeyReveal({ baseUrl, ingestKey }: { baseUrl: string; ingestKey: string }) {
  const [copied, setCopied] = useState(false);
  const text = `AUTOSANA_URL=${baseUrl}\nAUTOSANA_KEY=${ingestKey}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border border-line">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 py-1.5 pl-3 pr-1.5">
          <span className="font-mono text-[12px] text-fg-3">.env</span>
          <button
            type="button"
            onClick={() => {
              // Sin permiso de portapapeles (o fuera de HTTPS) falla: no se marca como copiado.
              navigator.clipboard.writeText(text).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
            className="btn btn-ghost btn-sm h-7"
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
        <pre className="overflow-auto p-3 font-mono text-[12px] leading-relaxed">{text}</pre>
      </div>
      <p className="flex items-start gap-2 text-[12px] text-warn">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Guárdala ahora: Fixie solo guarda su huella y no podrá mostrártela otra vez.
      </p>
    </div>
  );
}

const ROLE_SQL = `-- Rol de solo lectura para Fixie (recomendado)
create role fixie login password 'una-contraseña-larga';
grant usage on schema public to fixie;
grant select on all tables in schema public to fixie;
alter default privileges in schema public grant select on tables to fixie;
-- Sin INSERT, UPDATE, DELETE ni TRUNCATE: aunque la IA lo intentara,
-- Postgres lo rechaza. Si un arreglo necesita una columna nueva,
-- Fixie deja el SQL en el PR para que tú lo apliques.`;

export function DbRoleHelp() {
  return (
    <details className="group rounded-lg border border-line">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
        <Lock className="h-4 w-4 shrink-0 text-accent" />
        <span className="flex-1">La IA nunca borra ni modifica datos. ¿Cómo se garantiza?</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-fg-3 transition-transform group-open:rotate-90" />
      </summary>
      <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-[13px] leading-relaxed text-fg-2">
        <ul className="flex list-disc flex-col gap-1 pl-4 marker:text-fg-3">
          <li>Las consultas de la IA corren en transacciones de solo lectura.</li>
          <li>Solo puede proponer SQL que agrega estructura. DROP, DELETE, UPDATE, TRUNCATE, RENAME y cambios de tipo se bloquean.</li>
          <li>Cada cambio se ensaya en una transacción que se deshace, y se respalda la base antes de aplicarlo.</li>
          <li>Para tener la garantía también en Postgres, conecta con un rol sin permisos de escritura:</li>
        </ul>
        <pre className="overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px] leading-relaxed">{ROLE_SQL}</pre>
      </div>
    </details>
  );
}
