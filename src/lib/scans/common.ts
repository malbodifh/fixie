// Tipos y utilidades compartidas por los análisis (sin dependencias de servidor
// en los tipos: el panel los importa solo como tipos).
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type ScanKind = "errors" | "pentest" | "pentest_deep" | "conversion" | "lighthouse" | "deps";
export type Severity = "critico" | "alto" | "medio" | "bajo" | "info";

export type Finding = {
  id: string;
  title: string;
  severity: Severity;
  passed: boolean;
  detail: string;
  fix?: string;
  /** No se arregla con código del repo (hosting, DNS, rotar secretos…): Fixie lo explica, no lo toca. */
  manual?: boolean;
  /** Dependencias: el paquete vulnerable y la versión corregida. */
  pkg?: { name: string; from: string; to: string };
  /** Conversión: el texto actual y el propuesto. El usuario decide si se aplica. */
  copy?: { from: string; to: string };
  /** Lighthouse: en qué perfiles falla. */
  strategies?: ("movil" | "escritorio")[];
};

/** Tipos cuyos hallazgos requieren la decisión del usuario: Fixie no los aplica solo. */
export const NEEDS_DECISION: ScanKind[] = ["conversion"];

/** Hallazgos que Fixie puede reparar solo con un PR. */
export function repairable(findings: Finding[]): Finding[] {
  return findings.filter((f) => !f.passed && !f.manual && f.severity !== "info");
}

export type ScanResult = {
  status: "ok" | "error" | "needs_public_url" | "running" | "needs_setup";
  score: number | null;
  summary: string;
  findings: Finding[];
  meta?: Record<string, unknown>;
};

const PENALTY: Record<Severity, number> = { critico: 35, alto: 20, medio: 10, bajo: 4, info: 0 };

export function scoreOf(findings: Finding[]): number {
  return Math.max(0, 100 - findings.filter((f) => !f.passed).reduce((s, f) => s + PENALTY[f.severity], 0));
}

export function summaryOf(findings: Finding[]): string {
  const failed = findings.filter((f) => !f.passed && f.severity !== "info");
  if (failed.length === 0) return "Todo en orden.";
  const by = (s: Severity) => failed.filter((f) => f.severity === s).length;
  return [
    by("critico") && `${by("critico")} crítico${by("critico") > 1 ? "s" : ""}`,
    by("alto") && `${by("alto")} alto${by("alto") > 1 ? "s" : ""}`,
    by("medio") && `${by("medio")} medio${by("medio") > 1 ? "s" : ""}`,
    by("bajo") && `${by("bajo")} bajo${by("bajo") > 1 ? "s" : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function privateV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Los 8 grupos de una IPv6 (admite "::" y una IPv4 al final), o null si no lo es. */
function v6Groups(ip: string): number[] | null {
  let s = ip.replace(/%.*$/, "");
  const v4 = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    s = `${s.slice(0, -v4[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2 ? [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** ¿La IP (v4 o v6) es local, privada o reservada? Ante la duda, sí. */
export function isPrivateIp(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) return privateV4(ip);
  const g = v6Groups(ip);
  if (!g) return true;
  const v4 = (hi: number, lo: number) => privateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1 y las IPv4 compatibles
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4(g[6], g[7]); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return v4(g[1], g[2]); // 6to4
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00;
}

export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(h.replace(/^\[|\]$/g, ""))) return isPrivateIp(h);
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local");
}

/**
 * En producción, falla si el host es interno o si su DNS apunta a una red
 * interna (127.0.0.1.nip.io, metadatos de la nube…). En desarrollo no revisa nada.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  const h = hostname.replace(/^\[|\]$/g, "");
  if (isLocalHost(hostname)) throw new Error("No se analizan direcciones internas.");
  if (isIP(h)) return;
  // Si no resuelve, la conexión fallará por su cuenta.
  const addresses = await lookup(h, { all: true, verbatim: true }).catch(() => []);
  if (addresses.some((a) => isPrivateIp(a.address))) throw new Error("No se analizan direcciones internas.");
}

const MAX_REDIRECTS = 5;

/**
 * Pide una URL de la app analizada. En producción nunca se llega a redes
 * internas (evita usar Fixie para sondear la infraestructura): se revisa el
 * host y su DNS antes de cada salto, y las redirecciones se siguen a mano para
 * revisar también cada destino. El tiempo límite cubre todos los saltos.
 */
export async function fetchApp(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  const follow = !init.redirect || init.redirect === "follow";
  let u = new URL(url);
  let method = init.method;
  for (let hop = 0; ; hop++) {
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("Solo http(s).");
    await assertPublicHost(u.hostname);
    const res = await fetch(u, {
      ...init,
      method,
      redirect: follow ? "manual" : init.redirect,
      cache: "no-store",
      signal,
      headers: { "user-agent": "FixieBot/1.0 (+análisis autorizado por el dueño)", ...init.headers },
    });
    const location = res.headers.get("location");
    if (!follow || res.status < 300 || res.status >= 400 || !location) return res;
    if (hop >= MAX_REDIRECTS) throw new Error("Demasiadas redirecciones.");
    await res.body?.cancel().catch(() => {});
    u = new URL(location, u);
    if (res.status === 303 && method && !/^(GET|HEAD)$/i.test(method)) method = "GET";
  }
}
