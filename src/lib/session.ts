import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { sign, safeEqual } from "./crypto";
import { db, type UserRow } from "./db";

const COOKIE = "autosana_session";
const MAX_AGE_S = 30 * 24 * 3600;

export type CurrentUser = { id: string; login: string; name: string | null; avatarUrl: string | null };

function seal(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const body = `${userId}.${exp}`;
  return `${body}.${sign(body)}`;
}

function unseal(value: string | undefined): string | null {
  const [userId, exp, sig] = value?.split(".") ?? [];
  if (!userId || !exp || !sig) return null;
  if (!safeEqual(sig, sign(`${userId}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return userId;
}

export async function startSession(userId: string) {
  (await cookies()).set(COOKIE, seal(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/** Fila completa del usuario (incluye el token cifrado). Solo para el servidor. */
export async function getUserRow(): Promise<UserRow | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  // La sesión vence: comparar con la hora actual solo en tiempo de petición.
  await connection();
  const userId = unseal(value);
  if (!userId) return null;
  const { data } = await db().from("users").select("*").eq("id", userId).maybeSingle<UserRow>();
  return data ?? null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const row = await getUserRow();
  return row ? { id: row.id, login: row.login, name: row.name, avatarUrl: row.avatar_url } : null;
}

/** Para páginas y acciones privadas: sin sesión, al login. */
export async function requireUserRow(): Promise<UserRow> {
  const row = await getUserRow();
  if (!row) redirect("/?login=1");
  return row;
}
