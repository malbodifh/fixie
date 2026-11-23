"use client";

import { Check, Copy, KeyRound, RotateCw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { timeAgo } from "../time";
import { createTokenAction, revokeTokenAction } from "./actions";

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        // Si el portapapeles falla (sin permiso o fuera de HTTPS), no se dice "Copiado".
        const ok = await navigator.clipboard.writeText(text).then(
          () => true,
          () => false,
        );
        if (!ok) return;
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="btn btn-outline btn-sm shrink-0"
      aria-label={done ? "Copiado" : label}
    >
      {done ? <Check /> : <Copy />}
      {done ? "Copiado" : label}
    </button>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-3 py-2">
        <p className="text-[13px] font-medium">{title}</p>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto bg-surface p-3 font-mono text-[12px] leading-relaxed text-fg-2">{code}</pre>
    </div>
  );
}

export function TokenPanel({ url, hint, createdAt }: { url: string; hint: string | null; createdAt: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = token ?? "TU_TOKEN";

  const create = () => {
    // Uno nuevo invalida el anterior al instante, igual que generar una clave nueva del proyecto.
    if (hint && !confirm("El token actual dejará de funcionar. ¿Crear uno nuevo?")) return;
    start(async () => {
      setError(null);
      const res = await createTokenAction();
      if (res.token) setToken(res.token);
      else setError(res.error ?? "No pude crear el token.");
    });
  };
  const revoke = () => {
    // Revocar desconecta al instante a la IA que lo use: se confirma, como las demás acciones destructivas.
    if (!confirm("Tu IA dejará de poder entrar a Fixie con este token. ¿Revocarlo?")) return;
    start(async () => {
      setError(null);
      const res = await revokeTokenAction();
      if (res.ok) setToken(null);
      else setError(res.error ?? "No pude revocar el token.");
    });
  };

  const claudeCode = `claude mcp add --transport http fixie ${url} \\\n  --header "Authorization: Bearer ${shown}"`;
  const json = JSON.stringify({ mcpServers: { fixie: { url, headers: { Authorization: `Bearer ${shown}` } } } }, null, 2);

  return (
    <div className="flex flex-col gap-6">
      <section className="card overflow-hidden">
        <div className="card-head">
          <p className="text-[14px] font-semibold">1. Tu token personal</p>
        </div>
        <div className="flex flex-col gap-4 p-5">
          {token ? (
            <>
              <p className="text-[14px] text-fg-2">Cópialo ahora: por seguridad no se vuelve a mostrar. Si lo pierdes, crea uno nuevo.</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[13px]">{token}</code>
                <CopyButton text={token} label="Copiar token" />
              </div>
            </>
          ) : hint ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-[14px]">
                <KeyRound className="h-4 w-4 text-fg-3" />
                <span className="font-mono text-[13px]">{hint}</span>
                {createdAt && (
                  <span className="text-fg-3" suppressHydrationWarning>
                    · creado {timeAgo(createdAt)}
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={create} disabled={pending} className="btn btn-outline btn-sm">
                  <RotateCw />
                  Crear uno nuevo
                </button>
                <button type="button" onClick={revoke} disabled={pending} className="btn btn-ghost btn-sm text-bad">
                  <Trash2 />
                  Revocar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[14px] text-fg-2">Tu IA usa este token para entrar a Fixie como tú. Solo ve tus proyectos.</p>
              <button type="button" onClick={create} disabled={pending} className="btn btn-primary shrink-0">
                <KeyRound />
                {pending ? "Creando…" : "Crear token"}
              </button>
            </div>
          )}
          {hint && !token && <p className="text-[13px] text-fg-3">Crear uno nuevo invalida el anterior al instante.</p>}
          {error && (
            <p className="text-[13px] text-bad" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="card-head">
          <p className="text-[14px] font-semibold">2. Agrégalo a tu IA</p>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <Snippet title="Claude Code (terminal)" code={claudeCode} />
          <Snippet title="Cursor, Windsurf y otros clientes MCP (JSON)" code={json} />
          {!token && <p className="text-[13px] text-fg-3">Reemplaza TU_TOKEN por tu token. Al crear uno, aparece aquí ya puesto.</p>}
        </div>
      </section>
    </div>
  );
}
