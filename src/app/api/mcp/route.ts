import { z } from "zod";
import { ASSISTANT_TOOLS, GUIDE, toolErrorText } from "@/lib/assistant";
import { userByMcpToken } from "@/lib/mcp-token";

/**
 * Servidor MCP de Fixie (Streamable HTTP, sin estado). La IA del usuario
 * (Claude Code, Cursor…) se conecta con su token personal y usa las mismas
 * herramientas que el chat del panel. El modelo lo pone el cliente: no gasta
 * créditos de Fixie (solo las acciones que arrancan al agente, como reparar).
 */

export const maxDuration = 120;

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/** Un lote grande corre muchas herramientas en una sola petición: se limita. */
const MAX_BATCH = 20;

type RpcId = string | number;
type RpcRequest = { jsonrpc: "2.0"; id?: RpcId; method: string; params?: Record<string, unknown> };

const rpcError = (id: RpcId | null | undefined, code: number, message: string) => ({ jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } });

const TOOLS = ASSISTANT_TOOLS.map((t) => {
  const inputSchema = z.toJSONSchema(t.schema) as Record<string, unknown>;
  delete inputSchema.$schema;
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema,
    annotations: { title: t.title, readOnlyHint: !t.action, destructiveHint: false, idempotentHint: !t.action, openWorldHint: false },
  };
});

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is RpcId => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const user = token ? await userByMcpToken(token) : null;
  if (!user) {
    return Response.json(rpcError(null, -32001, "Token de Fixie inválido o revocado. Crea uno nuevo en Conectar tu IA."), {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="Fixie"' },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(rpcError(null, -32700, "JSON inválido"), { status: 400 });
  }

  const call = async (msg: RpcRequest & { id: RpcId }) => {
    switch (msg.method) {
      case "initialize": {
        const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : PROTOCOLS[0];
        return {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "fixie", title: "Fixie", version: "1.0.0" },
            instructions: GUIDE,
          },
        };
      }
      case "ping":
        return { jsonrpc: "2.0", id: msg.id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } };
      case "tools/call": {
        const name = msg.params?.name;
        const tool = typeof name === "string" ? ASSISTANT_TOOLS.find((t) => t.name === name) : undefined;
        if (!tool) return rpcError(msg.id, -32602, `Herramienta desconocida: ${typeof name === "string" ? name.slice(0, 100) : "(sin nombre)"}`);
        const parsed = tool.schema.safeParse(msg.params?.arguments ?? {});
        if (!parsed.success) {
          return { jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: `Argumentos inválidos: ${parsed.error.issues.map((i) => i.message).join("; ")}` }] } };
        }
        try {
          const out = await tool.run(parsed.data as Record<string, unknown>, user);
          return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] } };
        } catch (err) {
          return { jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: toolErrorText(err) }] } };
        }
      }
      default:
        return rpcError(msg.id, -32601, `Método no soportado: ${msg.method.slice(0, 100)}`);
    }
  };

  /** Una entrada del lote: petición (con respuesta), notificación o respuesta del cliente (sin respuesta). */
  const handle = async (raw: unknown) => {
    if (!isObject(raw) || raw.jsonrpc !== "2.0") return rpcError(null, -32600, "Petición inválida");
    const hasId = "id" in raw && raw.id !== undefined;
    if (typeof raw.method !== "string") {
      // Respuestas del cliente a peticiones del servidor: este servidor no hace ninguna, se ignoran.
      if (hasId && ("result" in raw || "error" in raw)) return null;
      return rpcError(isId(raw.id) ? raw.id : null, -32600, "Petición inválida");
    }
    if (raw.params !== undefined && !isObject(raw.params)) return hasId ? rpcError(isId(raw.id) ? raw.id : null, -32602, "params debe ser un objeto") : null;
    // Notificaciones (sin id): no llevan respuesta.
    if (!hasId) return null;
    // MCP: el id de una petición es texto o número, nunca null.
    if (!isId(raw.id)) return rpcError(null, -32600, "El id debe ser texto o número");
    try {
      return await call(raw as RpcRequest & { id: RpcId });
    } catch (err) {
      console.error("[mcp]", raw.method, err);
      return rpcError(raw.id, -32603, "Error interno");
    }
  };

  if (Array.isArray(body)) {
    if (body.length === 0) return Response.json(rpcError(null, -32600, "Lote vacío"), { status: 400 });
    if (body.length > MAX_BATCH) return Response.json(rpcError(null, -32600, `Lote demasiado grande (máximo ${MAX_BATCH})`), { status: 400 });
    // En orden, una tras otra: dos acciones del mismo lote no compiten por el mismo incidente.
    const out = [];
    for (const m of body) {
      const res = await handle(m);
      if (res) out.push(res);
    }
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const out = await handle(body);
  return out ? Response.json(out) : new Response(null, { status: 202 });
}

// Sin estado: no hay flujo SSE abierto por el servidor ni sesiones que cerrar.
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
