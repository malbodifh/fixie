// Tipos y utilidades compartidas por los análisis (sin dependencias de servidor
// en los tipos: el panel los importa).

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

export function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^0\./.test(hostname) ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local")
  );
}

/**
 * Pide una URL de la app analizada. En producción nunca se llega a redes
 * internas (evita usar Autosana para sondear la infraestructura).
 */
export async function fetchApp(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Solo http(s).");
  if (process.env.NODE_ENV === "production" && isLocalHost(u.hostname)) throw new Error("No se analizan direcciones internas.");
  return fetch(u, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "FixieBot/1.0 (+análisis autorizado por el dueño)", ...init.headers },
  });
}
