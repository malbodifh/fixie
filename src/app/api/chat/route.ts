import { after } from "next/server";
import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, safeValidateUIMessages, streamText, tool, toUIMessageStream } from "ai";
import { fastModel, hasModelKey, missingKeyMessage, NO_THINKING } from "@/lib/agent/model";
import { ASSISTANT_TOOLS, GUIDE, toolErrorText } from "@/lib/assistant";
import { getUserRow } from "@/lib/session";
import { BudgetExceededError, providerError, startMeter } from "@/lib/usage";

/**
 * Chat de ayuda del panel. Usa DeepSeek y gasta créditos del plan como el
 * resto del trabajo con IA; al llegar al límite se corta en ese momento.
 * (Conectar la IA propia por MCP no gasta créditos.)
 */

export const maxDuration = 120;

/** Solo los últimos mensajes viajan al modelo: el historial largo gasta créditos sin aportar. */
const MAX_MESSAGES = 16;
/** Tope del cuerpo: un historial inflado encarece cada paso y escapa a la reserva por paso del medidor. */
const MAX_BODY_CHARS = 200_000;
/**
 * Chats a la vez por usuario en esta instancia. El medidor revisa el saldo al
 * terminar cada paso: muchas peticiones simultáneas pasarían todas la revisión
 * inicial antes de que se registre la primera.
 */
const MAX_IN_FLIGHT = 2;
const inFlight = new Map<string, number>();

export async function POST(req: Request) {
  const user = await getUserRow();
  if (!user) return new Response("Inicia sesión para usar el asistente.", { status: 401 });
  if (!hasModelKey()) return new Response(`${missingKeyMessage()} Mientras tanto puedes conectar tu propia IA por MCP.`, { status: 503 });

  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY_CHARS) return new Response("La conversación es demasiado larga. Empieza una nueva.", { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Petición inválida.", { status: 400 });
  }
  const list = typeof body === "object" && body !== null ? (body as { messages?: unknown }).messages : undefined;
  if (!Array.isArray(list)) return new Response("Petición inválida.", { status: 400 });
  const valid = await safeValidateUIMessages({ messages: list.slice(-MAX_MESSAGES) });
  if (!valid.success) return new Response("Petición inválida.", { status: 400 });
  // Las instrucciones las pone el servidor: un mensaje "system" del cliente no las reemplaza.
  const messages = valid.data.filter((m) => m.role !== "system");
  if (messages.length === 0) return new Response("Petición inválida.", { status: 400 });

  if ((inFlight.get(user.id) ?? 0) >= MAX_IN_FLIGHT) return new Response("Ya hay una respuesta en curso. Espera a que termine.", { status: 429 });

  let meter: Awaited<ReturnType<typeof startMeter>>;
  try {
    meter = await startMeter({ ownerId: user.id, projectId: null, kind: "chat", critical: false });
  } catch (err) {
    if (err instanceof BudgetExceededError) return new Response(`${err.message} Mientras tanto puedes usar tu propia IA por MCP, que no gasta créditos.`, { status: 402 });
    throw err;
  }

  const tools = Object.fromEntries(
    ASSISTANT_TOOLS.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.schema,
        // Las acciones (analizar, reparar) gastan créditos y cambian cosas: el usuario las
        // aprueba en el chat. Así un texto de error con instrucciones no las dispara solo.
        needsApproval: t.action === true,
        execute: async (input: Record<string, unknown>) => {
          try {
            return await t.run(input, user);
          } catch (err) {
            return { error: toolErrorText(err) };
          }
        },
      }),
    ]),
  );

  const result = streamText({
    model: fastModel(),
    instructions: `${GUIDE}\n\nEstás dentro del panel de Fixie, hablando con ${user.name ?? user.login}. Respuestas breves: el chat gasta créditos de su plan.`,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: [isStepCount(6), meter.hooks.stopWhen],
    onStepEnd: meter.hooks.onStepEnd,
    maxOutputTokens: 1500,
    providerOptions: NO_THINKING,
  });

  inFlight.set(user.id, (inFlight.get(user.id) ?? 0) + 1);
  const release = () => {
    const n = (inFlight.get(user.id) ?? 1) - 1;
    if (n > 0) inFlight.set(user.id, n);
    else inFlight.delete(user.id);
  };
  // Se consume en el servidor hasta el final aunque el cliente se desconecte:
  // así cada paso llega a onStepEnd y se cobra. Cortar la conexión a mitad de
  // un paso no puede servir para usar el modelo sin que se registre.
  const done = Promise.resolve(result.consumeStream({ onError: (err) => console.error("[chat]", err) }))
    .catch((err: unknown) => console.error("[chat]", err))
    .finally(release);
  after(() => done);

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (err) => {
        // Solo los errores del proveedor ya explicados llegan al usuario; el resto se registra.
        const e = providerError(err);
        if (e !== err && e instanceof Error) return e.message;
        console.error("[chat]", err);
        return "El asistente no pudo responder. Intenta de nuevo.";
      },
    }),
  });
}
