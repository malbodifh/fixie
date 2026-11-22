import "server-only";
import { isLocalHost, type Finding, type ScanResult, type Severity } from "./common";

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
const METRICS = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"] as const;
const STRATEGIES = [
  { id: "mobile", label: "movil" },
  { id: "desktop", label: "escritorio" },
] as const;
type Category = (typeof CATEGORIES)[number];
type StrategyLabel = (typeof STRATEGIES)[number]["label"];

/** La meta: todas las categorías en 90 o más, en móvil y en escritorio. */
export const LIGHTHOUSE_TARGET = 90;

/** Auditorías que no se arreglan con código del repo: dependen del hosting o la red. */
const HOSTING = new Set(["server-response-time", "is-on-https", "redirects-http", "uses-http2", "uses-text-compression"]);

type Audit = { id: string; title: string; description?: string; score: number | null; scoreDisplayMode?: string; displayValue?: string };
type Psi = {
  lighthouseResult?: {
    categories: Record<string, { score: number | null; auditRefs: { id: string; weight: number; group?: string }[] }>;
    audits: Record<string, Audit>;
  };
  error?: { message: string };
};

function plain(md: string): string {
  return md.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`/g, "").split(". ")[0].slice(0, 220);
}

async function psi(appUrl: string, strategy: "mobile" | "desktop"): Promise<{ ok: true; data: NonNullable<Psi["lighthouseResult"]> } | { ok: false; status: number; message: string }> {
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", appUrl);
  api.searchParams.set("strategy", strategy);
  for (const c of CATEGORIES) api.searchParams.append("category", c);
  if (process.env.PSI_API_KEY) api.searchParams.set("key", process.env.PSI_API_KEY);
  const res = await fetch(api, { cache: "no-store", signal: AbortSignal.timeout(150_000) });
  const data = (await res.json().catch(() => ({}))) as Psi;
  if (!res.ok || !data.lighthouseResult) return { ok: false, status: res.status, message: data.error?.message ?? String(res.status) };
  return { ok: true, data: data.lighthouseResult };
}

/**
 * Lighthouse real con PageSpeed Insights de Google, en móvil y escritorio.
 * Solo reporta lo que baja de 90 alguna categoría: eso es lo que Fixie repara.
 */
export async function runLighthouse(appUrl: string): Promise<ScanResult> {
  if (isLocalHost(new URL(appUrl).hostname)) {
    return {
      status: "needs_public_url",
      score: null,
      summary: "Lighthouse corre en los servidores de Google: necesita la URL pública de la app (por ejemplo, la de Vercel).",
      findings: [],
    };
  }

  const runs = await Promise.all(STRATEGIES.map(async (s) => ({ ...s, r: await psi(appUrl, s.id) })));
  const failed = runs.find((x) => !x.r.ok);
  if (failed && !failed.r.ok) {
    const quota = failed.r.status === 429 || /quota/i.test(failed.r.message);
    return {
      status: "error",
      score: null,
      summary:
        quota && !process.env.PSI_API_KEY
          ? "Google limita los análisis sin clave. Agrega PSI_API_KEY (gratis en Google Cloud → PageSpeed Insights API) en .env.local."
          : `PageSpeed Insights no pudo analizar la página (${failed.label}): ${failed.r.message.slice(0, 200)}`,
      findings: [],
    };
  }

  const scores = {} as Record<StrategyLabel, Record<Category, number>>;
  const metrics = {} as Record<StrategyLabel, Record<string, string>>;
  const byAudit = new Map<string, { audit: Audit; strategies: StrategyLabel[]; categories: Set<Category>; worst: number }>();

  for (const run of runs) {
    if (!run.r.ok) continue;
    const lr = run.r.data;
    scores[run.label] = Object.fromEntries(CATEGORIES.map((c) => [c, Math.round((lr.categories[c]?.score ?? 0) * 100)])) as Record<Category, number>;
    metrics[run.label] = Object.fromEntries(METRICS.map((m) => [m, lr.audits[m]?.displayValue ?? "—"]));
    for (const c of CATEGORIES) {
      if (scores[run.label][c] >= LIGHTHOUSE_TARGET) continue;
      // Esta categoría está bajo la meta: sus auditorías con peso que fallan.
      for (const ref of lr.categories[c]?.auditRefs ?? []) {
        const a = lr.audits[ref.id];
        const counts = ref.weight > 0 || (c === "performance" && a?.scoreDisplayMode === "metricSavings");
        if (!a || a.score === null || a.score >= 0.9 || !counts || METRICS.includes(a.id as (typeof METRICS)[number])) continue;
        const entry = byAudit.get(a.id) ?? { audit: a, strategies: [], categories: new Set<Category>(), worst: 1 };
        if (!entry.strategies.includes(run.label)) entry.strategies.push(run.label);
        entry.categories.add(c);
        entry.worst = Math.min(entry.worst, a.score);
        byAudit.set(a.id, entry);
      }
    }
  }

  const NAME: Record<Category, string> = { performance: "Rendimiento", accessibility: "Accesibilidad", "best-practices": "Buenas prácticas", seo: "SEO" };
  const findings: Finding[] = [...byAudit.values()]
    .sort((a, b) => a.worst - b.worst)
    .slice(0, 16)
    .map(({ audit: a, strategies, categories, worst }) => ({
      id: a.id,
      title: a.title,
      severity: (worst < 0.5 ? "medio" : "bajo") as Severity,
      passed: false,
      detail: `${[...categories].map((c) => NAME[c]).join(", ")} en ${strategies.map((s) => (s === "movil" ? "móvil" : "escritorio")).join(" y ")}. ${a.displayValue ? `${a.displayValue}. ` : ""}${plain(a.description ?? "")}`,
      strategies,
      manual: HOSTING.has(a.id) || undefined,
    }));

  // El puntaje es la peor categoría: la meta es que ninguna baje de 90.
  const all = Object.values(scores).flatMap((s) => Object.values(s));
  const score = Math.min(...all);
  const below = STRATEGIES.flatMap((s) => CATEGORIES.filter((c) => scores[s.label][c] < LIGHTHOUSE_TARGET).map((c) => `${NAME[c]} ${scores[s.label][c]} (${s.label === "movil" ? "móvil" : "escritorio"})`));
  return {
    status: "ok",
    score,
    summary: below.length ? `Bajo 90: ${below.join(" · ")}` : "Todo en 90 o más, en móvil y escritorio.",
    findings,
    meta: { scores, metrics, categories: scores.movil },
  };
}
