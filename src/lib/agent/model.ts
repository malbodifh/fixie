import { createDeepSeek } from "@ai-sdk/deepseek";
import type { LanguageModel } from "ai";

/**
 * Los agentes usan DeepSeek V4.1 Flash (checkpoint 1017). En la API de DeepSeek
 * ese checkpoint se pide con el alias `deepseek-flash`. AGENT_MODEL y
 * AGENT_FAST_MODEL permiten cambiarlo sin tocar código.
 */
const DEFAULT_MODEL = "deepseek-flash";

/** ¿Hay clave para el modelo? Sin ella, Fixie no abre reparaciones que lo necesitan. */
export function hasModelKey(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

function provider() {
  if (!hasModelKey()) {
    throw new Error("Falta la clave del modelo: agrega DEEPSEEK_API_KEY en la configuración del servidor.");
  }
  return createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });
}

/** Modelo del agente: reproduce, repara y revisa. */
export function agentModel(): LanguageModel {
  return provider()(process.env.AGENT_MODEL ?? DEFAULT_MODEL);
}

/** Modelo para tareas acotadas (sugerencias de texto, revisión del diff del día). */
export function fastModel(): LanguageModel {
  return provider()(process.env.AGENT_FAST_MODEL ?? process.env.AGENT_MODEL ?? DEFAULT_MODEL);
}

/** Nombre del modelo, para registrar el consumo. */
export function modelName(): string {
  return process.env.AGENT_MODEL ?? DEFAULT_MODEL;
}
