import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { sign, safeEqual } from "./crypto";
import { db, type UserRow } from "./db";

const COOKIE = "autosana_session";
const MAX_AGE_S = 30 * 24 * 3600;

export type CurrentUser = { id: string; login: string; name: string | null; avatarUrl: string | null; plan: UserRow["plan"] };

type Sealed = { userId: string; version: number };

// La cookie lleva la versión de sesión del usuario: al cerrar sesión la versión sube
// y toda cookie anterior (en otro dispositivo, o robada) deja de valer.
function seal({ userId, version }: Sealed): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const body = `${userId}.${version}.${exp}`;
  return `${body}.${sign(body)}`;
}

function unseal(value: string | undefined): Sealed | null {
  const [userId, version, exp, sig, extra] = value?.split(".") ?? [];
  if (!userId || !version || !exp || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, sign(`${userId}.${version}.${exp}`))) return null;
  if (!/^\d+$/.test(version) || Number(exp) < Date.now() / 1000) return null;
  return { userId, version: Number(version) };
}

export async function startSession(user: Pick<UserRow, "id" | "session_version">) {
  (await cookies()).set(COOKIE, seal({ userId: user.id, version: user.session_version ?? 0 }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

/** Cierra la sesión en todos los dispositivos: la versión sube y las cookies emitidas antes dejan de valer. */
export async function endSession() {
  const jar = await cookies();
  const sealed = unseal(jar.get(COOKIE)?.value);
  jar.delete(COOKIE);
  if (!sealed) return;
  // Solo si la cookie sigue vigente: una cookie vieja no puede cerrar las sesiones nuevas.
  await db()
    .from("users")
    .update({ session_version: sealed.version + 1 })
    .eq("id", sealed.userId)
    .eq("session_version", sealed.version);
}

/** Fila completa del usuario (incluye el token cifrado). Solo para el servidor. */
export async function getUserRow(): Promise<UserRow | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  // La sesión vence: comparar con la hora actual solo en tiempo de petición.
  await connection();
  const sealed = unseal(value);
  if (!sealed) return null;
  const { data } = await db().from("users").select("*").eq("id", sealed.userId).maybeSingle<UserRow>();
  if (!data || (data.session_version ?? 0) !== sealed.version) return null;
  return data;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const row = await getUserRow();
  return row ? { id: row.id, login: row.login, name: row.name, avatarUrl: row.avatar_url, plan: row.plan ?? "free" } : null;
}

/** Para páginas y acciones privadas: sin sesión, al login. */
export async function requireUserRow(): Promise<UserRow> {
  const row = await getUserRow();
  if (!row) redirect("/?login=1");
  return row;
}
