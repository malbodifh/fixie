import { Suspense } from "react";
import { requireUserRow } from "@/lib/session";
import { AppShell } from "../app-shell";
import { AssistantChat } from "./chat";

export const metadata = { title: "Asistente" };

export default function AssistantPage() {
  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-[760px] flex-1 flex-col px-4 md:px-6">
        <Suspense fallback={<div className="flex-1 pt-14" aria-label="Cargando asistente"><span className="skeleton block h-8 w-72" /></div>}>
          <Chat />
        </Suspense>
      </main>
    </AppShell>
  );
}

async function Chat() {
  const user = await requireUserRow();
  // Un nombre vacío o solo con espacios no debe dejar "Hola, ." en el saludo.
  return <AssistantChat name={user.name?.trim().split(/\s+/)[0] || user.login} />;
}
