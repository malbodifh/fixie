import "server-only";
import { generateText, isStepCount, tool } from "ai";
import type { z } from "zod";
import { agentModel, fastModel } from "./model";

/** Una sola respuesta estructurada del modelo (una herramienta forzada), sin bucle de agente. */
export async function askStructured<S extends z.ZodType>(opts: {
  name: string;
  description: string;
  schema: S;
  instructions: string;
  prompt: string;
  fast?: boolean;
  maxOutputTokens?: number;
}): Promise<z.infer<S> | null> {
  let out: z.infer<S> | null = null;
  await generateText({
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
    stopWhen: [() => out !== null, isStepCount(2)],
    maxOutputTokens: opts.maxOutputTokens ?? 4000,
  });
  return out;
}
