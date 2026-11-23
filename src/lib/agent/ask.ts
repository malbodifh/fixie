import "server-only";
import { generateText, isStepCount, tool } from "ai";
import type { z } from "zod";
import type { ProjectRow } from "../db";
import { metered, type UsageKind } from "../usage";
import { agentModel, fastModel, NO_THINKING } from "./model";

/** Una sola respuesta estructurada del modelo (una herramienta forzada), sin bucle de agente. */
export async function askStructured<S extends z.ZodType>(opts: {
  name: string;
  description: string;
  schema: S;
  instructions: string;
  prompt: string;
  fast?: boolean;
  maxOutputTokens?: number;
  /** A quién se le cobra el consumo. */
  usage: { project: Pick<ProjectRow, "id" | "owner_id">; kind: UsageKind };
}): Promise<z.infer<S> | null> {
  let out: z.infer<S> | null = null;
  await metered({ ...opts.usage, critical: false, done: () => out !== null }, (m) =>
    generateText({
    model: opts.fast ? fastModel() : agentModel(),
    instructions: opts.instructions,
    prompt: opts.prompt,
    tools: {
      [opts.name]: tool({
        description: opts.description,
        inputSchema: opts.schema,
        execute: async (input: z.infer<S>) => {
          out = input;
          return { ok: true };
        },
      }),
    },
    toolChoice: { type: "tool", toolName: opts.name },
    stopWhen: [() => out !== null, isStepCount(2), m.stopWhen],
    onStepEnd: m.onStepEnd,
    maxOutputTokens: opts.maxOutputTokens ?? 4000,
    // Las tareas rápidas no necesitan razonamiento extendido: menos tokens y menos espera.
    providerOptions: opts.fast ? NO_THINKING : undefined,
  }));
  return out;
}
