import { createAnthropic } from "@ai-sdk/anthropic";
import { gateway, type LanguageModel } from "ai";

/** ¿Hay clave para el modelo? Sin ella, Fixie no abre reparaciones que lo necesitan. */
export function hasModelKey(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_API_KEY);
}

function requireKey(): void {
  if (!hasModelKey()) {
    throw new Error("Falta la clave del modelo: agrega ANTHROPIC_API_KEY en .env.local (o AI_GATEWAY_API_KEY).");
  }
}

/**
 * Modelo del agente. Con ANTHROPIC_API_KEY va directo a Anthropic; si no,
 * pasa por el Vercel AI Gateway (AI_GATEWAY_API_KEY).
 */
export function agentModel(): LanguageModel {
  requireKey();
  if (process.env.ANTHROPIC_API_KEY) {
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(process.env.AGENT_MODEL ?? "claude-sonnet-5-5");
  }
  return gateway(process.env.AGENT_MODEL ?? "anthropic/claude-sonnet-5.5");
}

/** Modelo barato para tareas acotadas (sugerencias de texto, revisión del diff del día). */
export function fastModel(): LanguageModel {
  requireKey();
  if (process.env.ANTHROPIC_API_KEY) {
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(process.env.AGENT_FAST_MODEL ?? "claude-haiku-5-5");
  }
  return gateway(process.env.AGENT_FAST_MODEL ?? "anthropic/claude-haiku-5.5");
}
