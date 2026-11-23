import "server-only";
import { randomBytes } from "node:crypto";
import { sha256 } from "./crypto";
import { db, must, type UserRow } from "./db";

/** Token personal para conectar una IA por MCP: se muestra una vez y se guarda solo su hash. */
export async function createMcpToken(userId: string): Promise<string> {
  const token = `fixie_${randomBytes(24).toString("base64url")}`;
  must(
    await db()
      .from("users")
      .update({ mcp_token_hash: sha256(token), mcp_token_hint: `${token.slice(0, 10)}…${token.slice(-4)}`, mcp_token_created_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id")
      .single(),
  );
  return token;
}

export async function revokeMcpToken(userId: string): Promise<void> {
  must(await db().from("users").update({ mcp_token_hash: null, mcp_token_hint: null, mcp_token_created_at: null }).eq("id", userId).select("id").single());
}

export async function userByMcpToken(token: string): Promise<UserRow | null> {
  if (!token.startsWith("fixie_") || token.length > 100) return null;
  const { data } = await db().from("users").select("*").eq("mcp_token_hash", sha256(token)).maybeSingle<UserRow>();
  return data ?? null;
}
