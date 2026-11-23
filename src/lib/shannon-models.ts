/**
 * Modelos que Fixie ofrece para el pentest profundo. El valor es el que Shannon
 * lee en SHANNON_AI_MODEL (`<proveedor>:<modelo>` del catálogo de pi). La clave
 * la pone el cliente: la corrida se cobra en su cuenta, no en los créditos de Fixie.
 */
export const SHANNON_MODELS = [
  {
    id: "deepseek",
    spec: "deepseek:deepseek-flash",
    label: "DeepSeek V4.1 Flash",
    keyHint: "sk-…",
    note: "El más barato. En la prueba pública de Shannon, una app grande costó US$6.10 por corrida.",
  },
  {
    id: "anthropic",
    spec: "anthropic:claude-sonnet-5",
    label: "Claude Sonnet 5 (Anthropic)",
    keyHint: "sk-ant-…",
    note: "Encuentra fallas más sutiles. Cuesta bastante más por corrida.",
  },
] as const;

export type ShannonModelId = (typeof SHANNON_MODELS)[number]["id"];

export const DEFAULT_SHANNON_MODEL: ShannonModelId = "deepseek";

export function shannonModel(id: string | null | undefined) {
  return SHANNON_MODELS.find((m) => m.id === id || m.spec === id) ?? null;
}
