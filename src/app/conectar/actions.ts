"use server";

import { refresh } from "next/cache";
import { createMcpToken, revokeMcpToken } from "@/lib/mcp-token";
import { requireUserRow } from "@/lib/session";

export async function createTokenAction(): Promise<{ token?: string; error?: string }> {
  const user = await requireUserRow();
  try {
    const token = await createMcpToken(user.id);
    refresh();
    return { token };
  } catch {
    return { error: "No pude crear el token. Intenta de nuevo." };
  }
}

export async function revokeTokenAction(): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUserRow();
  try {
    await revokeMcpToken(user.id);
    refresh();
    return { ok: true };
  } catch {
    return { error: "No pude revocar el token." };
  }
}
