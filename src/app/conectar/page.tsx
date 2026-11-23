import { Suspense } from "react";
import { ASSISTANT_TOOLS } from "@/lib/assistant";
import { env } from "@/lib/env";
import { requireUserRow } from "@/lib/session";
import { AppShell } from "../app-shell";
import { TokenPanel } from "./token-panel";

export const metadata = { title: "Conectar tu IA" };

export default function ConnectPage() {
  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-8 px-4 pb-20 pt-10 md:px-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Conecta tu IA</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-fg-2">
            Pregúntale a Claude, Cursor u otra IA compatible con MCP por tus proyectos, sin salir de donde trabajas. El modelo lo pone tu IA, así que no gasta créditos de Fixie. Solo
            las acciones que ponen a trabajar al agente, como reparar un incidente, gastan créditos, igual que en el panel.
          </p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Suspense fallback={<span className="skeleton h-64" aria-label="Cargando" />}>
            <Token />
          </Suspense>
          <section className="card overflow-hidden">
            <div className="card-head">
              <p className="text-[14px] font-semibold">Lo que puede hacer</p>
            </div>
            <ul className="flex flex-col gap-3 p-5">
              {ASSISTANT_TOOLS.map((t) => (
                <li key={t.name}>
                  <p className="flex items-center gap-2 text-[14px] font-medium">
                    {t.title}
                    {t.action && <span className="badge bg-surface-2 text-fg-2">Acción</span>}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-snug text-fg-2">{t.description}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

async function Token() {
  const user = await requireUserRow();
  return <TokenPanel url={`${env.baseUrl()}/api/mcp`} hint={user.mcp_token_hint ?? null} createdAt={user.mcp_token_created_at ?? null} />;
}
