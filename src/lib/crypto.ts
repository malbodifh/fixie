import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

const key = () => createHash("sha256").update(`cifrado:${env.secret()}`).digest();

/** AES-256-GCM. Formato: iv.tag.datos (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function sign(value: string): string {
  return createHmac("sha256", `firma:${env.secret()}`).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Clave de ingesta de un proyecto: se muestra una vez y se guarda solo su hash. */
export function newIngestKey(): { key: string; hash: string; hint: string } {
  const key = `asn_${randomBytes(24).toString("base64url")}`;
  return { key, hash: sha256(key), hint: `${key.slice(0, 8)}…${key.slice(-4)}` };
}

export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}
