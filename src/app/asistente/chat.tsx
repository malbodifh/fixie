"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from "ai";
import { Check, CircleAlert, CornerDownLeft, LoaderCircle, Mic, Plus, Square, X } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Mascot } from "../mascot";

const SUGGESTIONS = [
  "¿Cómo están mis proyectos?",
  "¿Por qué se detuvo mi último incidente?",
  "¿Cuántos créditos me quedan esta semana?",
  "¿Qué hace la Revisión completa?",
];

const QUICK = [...SUGGESTIONS, "Corre la revisión completa de mi proyecto", "Explícame qué arreglar primero en pentesting"];

const TOOL_LABEL: Record<string, string> = {
  listar_proyectos: "Revisando tus proyectos",
  estado_proyecto: "Leyendo el estado del proyecto",
  ver_incidente: "Abriendo el incidente",
  ver_uso: "Consultando tu uso",
  analizar: "Analizando tu app",
  reparar_incidente: "Poniendo a Fixie a reparar",
};

// ── Dictado por voz (Web Speech API, si el navegador la tiene) ──

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function speechCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const noop = () => () => {};

/**
 * Al enviar o salir se descarta el dictado: sin esto, el resultado final que llega
 * tras stop() volvería a llenar el campo con lo que ya se envió.
 */
function discardDictation(ref: RefObject<Recognition | null>) {
  const r = ref.current;
  if (!r) return;
  r.onresult = null;
  r.stop();
  ref.current = null;
}

const TRANSPORT = new DefaultChatTransport({ api: "/api/chat" });

// ── Texto del asistente: párrafos, viñetas y negritas, sin HTML del modelo ──

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith("**") && chunk.endsWith("**") ? (
      <strong key={i} className="font-semibold">
        {chunk.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{chunk.replace(/`/g, "")}</Fragment>
    ),
  );
}

function RichText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i} className="flex list-disc flex-col gap-1 pl-5 marker:text-fg-3">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(block.replace(/^#+\s*/gm, ""))}
          </p>
        );
      })}
    </div>
  );
}

type Approve = (id: string, approved: boolean) => void;

const KIND_LABEL: Record<string, string> = { errors: "Errores", pentest: "Pentesting", conversion: "Conversión", lighthouse: "Lighthouse", deps: "Dependencias" };

/** Lo que va a hacer una acción, en una frase, para aprobarla sabiendo qué es. */
function actionSummary(name: string, input: Record<string, unknown> | undefined): string {
  const project = typeof input?.proyecto === "string" && input.proyecto ? ` en ${input.proyecto}` : "";
  if (name === "analizar") return `Analizar ${KIND_LABEL[String(input?.tipo)] ?? "la app"}${project}. Si encuentra algo que se arregla con código, Fixie lo repara y eso gasta créditos.`;
  if (name === "reparar_incidente") return `Diagnosticar y reparar el incidente #${String(input?.numero ?? "")}${project}. Gasta créditos.`;
  return "Esta acción gasta créditos.";
}

function Message({ message, onApprove }: { message: UIMessage; onApprove: Approve }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="step-in flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 text-[15px] leading-relaxed">{text}</p>
      </div>
    );
  }
  return (
    <div className="step-in flex flex-col gap-2 text-[15px] leading-relaxed">
      {message.parts.map((part, i) => {
        if (part.type === "text") return part.text.trim() ? <RichText key={i} text={part.text} /> : null;
        if (part.type.startsWith("tool-")) {
          const name = part.type.slice(5);
          const { state, input, approval } = part as { state?: string; input?: Record<string, unknown>; approval?: { id: string } };
          if (state === "approval-requested" && approval) {
            return (
              <div key={i} className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-line bg-surface p-3.5">
                <p className="text-[14px] leading-snug text-fg">{actionSummary(name, input)}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => onApprove(approval.id, true)} className="btn btn-primary btn-sm">
                    Hacerlo
                  </button>
                  <button type="button" onClick={() => onApprove(approval.id, false)} className="btn btn-secondary btn-sm">
                    No
                  </button>
                </div>
              </div>
            );
          }
          const done = state === "output-available";
          const failed = state === "output-error" || state === "output-denied";
          return (
            <span key={i} className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-fg-2">
              {failed ? (
                <X className="h-3 w-3 text-bad" />
              ) : done ? (
                <Check className="h-3 w-3 text-ok" strokeWidth={2.5} />
              ) : (
                <LoaderCircle className="h-3 w-3 animate-spin text-accent" />
              )}
              {state === "output-denied" ? "Cancelado" : (TOOL_LABEL[name] ?? "Consultando Fixie")}
            </span>
          );
        }
        return null;
      })}
    </div>
  );
}

export function AssistantChat({ name }: { name: string }) {
  const { messages, sendMessage, status, stop, error, regenerate, clearError, addToolApprovalResponse } = useChat({
    transport: TRANSPORT,
    // Al aprobar o rechazar una acción, la conversación sigue sola.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const approve: Approve = (id, approved) => void addToolApprovalResponse({ id, approved });
  const [input, setInput] = useState("");
  const [menu, setMenu] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const canDictate = useSyncExternalStore(noop, () => speechCtor() !== null, () => false);

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  // El campo crece con el texto, hasta unas 8 líneas.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  useEffect(() => () => discardDictation(recognition), []);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    if (error) clearError();
    discardDictation(recognition);
    void sendMessage({ text: t });
    setInput("");
    setMenu(false);
    textarea.current?.focus();
  };

  const dictate = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "es-MX";
    r.interimResults = true;
    r.continuous = false;
    const before = input ? `${input.trimEnd()} ` : "";
    r.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      setInput(before + said);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    try {
      r.start();
    } catch {
      // Sin permiso de micrófono o con otro dictado activo: no se queda "escuchando".
      return;
    }
    recognition.current = r;
    setListening(true);
  };

  const mascotMode = busy ? "typing" : error ? "sad" : "idle";

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-start gap-6 pb-10 pt-6 md:pt-14">
            <div>
              <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Hola, {name}. ¿En qué te ayudo?</h1>
              <p className="mt-1.5 max-w-xl text-[15px] text-fg-2">Pregúntame por tus proyectos, un incidente o tus créditos. También puedo correr análisis y poner a Fixie a reparar.</p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-xl border border-line bg-surface px-4 py-3 text-left text-[14px] text-fg-2 transition-colors hover:border-line-2 hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 pb-10 pt-6">
            {messages.map((m) => (
              <Message key={m.id} message={m} onApprove={approve} />
            ))}
            {error && (
              <div className="step-in flex items-start justify-between gap-3 rounded-xl bg-bad-bg px-4 py-3 text-[14px] text-bad" role="alert">
                <span className="flex items-start gap-2">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {error.message || "El asistente no pudo responder."}
                </span>
                <button type="button" onClick={() => void regenerate()} className="shrink-0 font-medium underline underline-offset-2">
                  Reintentar
                </button>
              </div>
            )}
            {status === "submitted" && (
              <p className="flex items-center gap-2 text-[14px] text-fg-3" role="status">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Fixie está pensando…
              </p>
            )}
          </div>
        )}
        <div ref={end} />
      </div>

      {/* Barra de texto, con Fixie asomado en la esquina */}
      <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-bg/0 pb-4 pt-16">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <div className="fixie-peek pointer-events-none absolute bottom-full right-6 -mb-[7px]" data-busy={busy} aria-hidden>
            <div className="fixie-sway">
              <Mascot mode={mascotMode} size={60} title="Fixie" />
            </div>
          </div>

          <div className="flex items-end gap-1 rounded-2xl border border-line-2 bg-surface p-2 shadow-card transition-colors focus-within:border-accent">
            <div className="relative" ref={menuRef}>
              <button type="button" onClick={() => setMenu((m) => !m)} className="btn btn-ghost h-9 w-9 rounded-xl px-0" aria-label="Preguntas rápidas" aria-expanded={menu} aria-controls="quick-questions">
                <Plus className="!h-5 !w-5" />
              </button>
              {/* Lista de botones simples (no role="menu": no tiene la navegación con flechas que ese rol promete). */}
              {menu && (
                <div id="quick-questions" className="fade-in absolute bottom-full left-0 z-10 mb-2 w-[280px] max-w-[calc(100vw-48px)] rounded-xl border border-line bg-surface p-1.5 shadow-float" role="group" aria-labelledby="quick-questions-title">
                  <p id="quick-questions-title" className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-fg-3">Preguntas rápidas</p>
                  {QUICK.map((q) => (
                    <button key={q} type="button" onClick={() => send(q)} className="w-full rounded-lg px-2.5 py-2 text-left text-[14px] text-fg-2 hover:bg-surface-2 hover:text-fg">
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <label htmlFor="assistant-input" className="sr-only">
              Mensaje para Fixie
            </label>
            <textarea
              id="assistant-input"
              ref={textarea}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={listening ? "Te escucho…" : "Pregúntale a Fixie…"}
              className="composer-input max-h-[200px] min-h-9 flex-1 resize-none bg-transparent px-2 py-[7px] text-[15px] leading-[22px] outline-none placeholder:text-fg-3"
            />

            {busy ? (
              <button type="button" onClick={() => void stop()} className="btn btn-secondary h-9 w-9 rounded-xl px-0" aria-label="Detener respuesta" title="Detener">
                <Square className="!h-3.5 !w-3.5 fill-current" />
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} className="btn btn-primary h-9 w-9 rounded-xl px-0" aria-label="Enviar" title="Enviar (Enter)">
                <CornerDownLeft />
              </button>
            )}
            {canDictate && (
              <button
                type="button"
                onClick={dictate}
                className={`btn h-9 w-9 rounded-xl px-0 ${listening ? "bg-bad-bg text-bad" : "btn-ghost"}`}
                aria-label={listening ? "Dejar de dictar" : "Dictar con la voz"}
                aria-pressed={listening}
                title={listening ? "Dejar de dictar" : "Dictar"}
              >
                <Mic className={listening ? "live-dot" : undefined} />
              </button>
            )}
          </div>
        </form>
        <p className="mt-2 text-center text-[12px] text-fg-3">
          El asistente gasta créditos de tu plan. Con tu propia IA por MCP no gasta.{" "}
          <Link href="/conectar" className="font-medium text-fg-2 underline-offset-2 hover:underline">
            Conectar
          </Link>
        </p>
      </div>
    </div>
  );
}
