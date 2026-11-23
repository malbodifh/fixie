import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * Proveedor de los agentes. Por defecto DeepSeek V4.1 Flash (checkpoint 1017,
 * alias `deepseek-flash` en su API). Gemini queda como alterno: se usa si
 * AI_PROVIDER=gemini, o si no hay clave de DeepSeek pero sí GEMINI_API_KEY.
 * AGENT_MODEL y AGENT_FAST_MODEL cambian el modelo sin tocar código.
 */
type Provider = "deepseek" | "gemini";

const DEFAULTS: Record<Provider, string> = { deepseek: "deepseek-flash", gemini: "gemini-3.5-flash" };
const LABELS: Record<Provider, { name: string; env: string }> = {
  deepseek: { name: "DeepSeek", env: "DEEPSEEK_API_KEY" },
  gemini: { name: "Gemini", env: "GEMINI_API_KEY" },
};

function activeProvider(): Provider {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (forced === "gemini" || forced === "deepseek") return forced;
  if (!process.env.DEEPSEEK_API_KEY && process.env.GEMINI_API_KEY) return "gemini";
  return "deepseek";
}

/** Nombre del proveedor y de su variable de entorno, para los mensajes de error. */
export function providerLabel(): { name: string; env: string } {
  return LABELS[activeProvider()];
}

/** ¿Hay clave para el modelo? Sin ella, Fixie no abre reparaciones que lo necesitan. */
export function hasModelKey(): boolean {
  return !!process.env[providerLabel().env];
}

/** Mensaje cuando falta la clave del proveedor activo. */
export function missingKeyMessage(): string {
  return `Falta la clave del modelo: agrega ${providerLabel().env} en la configuración del servidor.`;
}

function model(id: string): LanguageModel {
  if (!hasModelKey()) throw new Error(missingKeyMessage());
  return activeProvider() === "gemini"
    ? createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })(id)
    : createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY })(id);
}

/** Modelo del agente: reproduce, repara y revisa. */
export function agentModel(): LanguageModel {
  return model(modelName());
}

/** Modelo para tareas acotadas (sugerencias de texto, revisión del diff del día). */
export function fastModel(): LanguageModel {
  return model(process.env.AGENT_FAST_MODEL ?? modelName());
}

/** Nombre del modelo, para registrar el consumo. */
export function modelName(): string {
  return process.env.AGENT_MODEL ?? DEFAULTS[activeProvider()];
}

/** Opciones para tareas rápidas: sin razonamiento extendido (menos tokens y menos espera). */
export const NO_THINKING = {
  deepseek: { thinking: { type: "disabled" } },
  google: { thinkingConfig: { thinkingLevel: "low" } },
};
