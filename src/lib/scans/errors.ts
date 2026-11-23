import "server-only";
import { z } from "zod";
import { askStructured } from "../agent/ask";
import { hasModelKey } from "../agent/model";
import type { ProjectRow } from "../db";
import { GitHubError, type Repo } from "../github";
import { BudgetExceededError } from "../usage";
import { fetchApp, HostBlockedError, mapLimit, scoreOf, summaryOf, type Finding, type ScanResult, type Severity } from "./common";

/**
 * Búsqueda diaria de errores, de lo más barato a lo más caro en tokens:
 * 1. Sin repo y sin IA: recorre las páginas de producción buscando errores 5xx,
 *    páginas de error de Next y archivos JS que no cargan.
 * 2. Con repo y sin IA: el estado del CI en la rama principal.
 * 3. Con repo y con IA: solo el diff desde la revisión anterior (si no hubo
 *    commits, cero tokens). El modelo busca bugs reales en lo que cambió.
 */

const MAX_PAGES = 25;
const MAX_DIFF = 60_000;

async function crawl(appUrl: string): Promise<Finding[]> {
  const origin = new URL(appUrl).origin;
  const f: Finding[] = [];
  const home = await fetchApp(appUrl, {}, 15_000).catch((err: unknown) => err as Error);
  // Si el firewall del hosting frenó a Fixie, el análisis falla entero: no es un error de la app.
  if (home instanceof HostBlockedError) throw home;
  if (home instanceof Error) {
    return [{ id: "down", title: "La app no responde", severity: "critico", passed: false, detail: `No respondió: ${home.message}.`, manual: true }];
  }
  const html = await home.text().catch(() => "");

  // Páginas: los enlaces internos de la portada y el sitemap.
  const pages = new Set<string>([new URL(appUrl).pathname || "/"]);
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], origin);
      if (u.origin === origin && !/\.(pdf|png|jpe?g|svg|webp|zip)$/i.test(u.pathname)) pages.add(u.pathname);
    } catch {}
  }
  const sitemap = await fetchApp(`${origin}/sitemap.xml`).catch(() => null);
  if (sitemap?.ok) {
    for (const m of (await sitemap.text().catch(() => "")).matchAll(/<loc>([^<]+)<\/loc>/g)) {
      try {
        const u = new URL(m[1].trim());
        if (u.origin === origin) pages.add(u.pathname);
      } catch {}
    }
  }

  const list = [...pages].slice(0, MAX_PAGES);
  // De a 4 páginas: una ráfaga de 25 peticiones dispara la protección contra bots del hosting.
  const results = await mapLimit(list, 4, async (path) => {
      const r = await fetchApp(`${origin}${path}`, {}, 15_000).catch((err: unknown) => (err instanceof HostBlockedError ? "blocked" : null));
      if (r === "blocked") return { path, status: -1, errorPage: false };
      const body = r ? await r.text().catch(() => "") : "";
      return { path, status: r?.status ?? 0, errorPage: /id=["']__next_error__["']|Internal Server Error|Application error: a (client|server)-side exception/i.test(body) };
  });
  for (const r of results) {
    if (r.status >= 500 || r.status === 0 || r.errorPage) {
      f.push({
        id: `page:${r.path}`,
        title: `${r.path} falla`,
        severity: r.path === "/" ? "critico" : "alto",
        passed: false,
        detail: r.status === 0 ? "No respondió." : `Respondió ${r.status}${r.errorPage ? " con la página de error" : ""}. Cada visita a esta página termina en error.`,
        fix: "Reproducir el error de esta ruta con una prueba y corregir el componente o la ruta de API que falla.",
      });
    }
  }

  // Archivos JS de la portada: si alguno no carga, la página queda rota en el navegador.
  const scripts = [...new Set([...html.matchAll(/<script\b[^>]*src=["'](\/_next\/[^"']+\.js)["']/gi)].map((m) => m[1]))].slice(0, 15);
  const broken: string[] = [];
  await Promise.all(
    scripts.map(async (src) => {
      const r = await fetchApp(`${origin}${src}`, { method: "HEAD" }).catch(() => null);
      if (r && r.status >= 400) broken.push(src);
    }),
  );
  if (broken.length) {
    f.push({
      id: "scripts",
      title: broken.length === 1 ? "1 archivo JS no carga" : `${broken.length} archivos JS no cargan`,
      severity: "alto",
      passed: false,
      detail: `Por ejemplo ${broken[0]}. Suele pasar cuando un despliegue quedó a medias o el caché apunta a una versión vieja.`,
      fix: "Vuelve a desplegar la última versión; si persiste, revisa la configuración de assetPrefix y del CDN.",
      manual: true,
    });
  }

  f.push({
    id: "crawl",
    title: list.length === 1 ? "1 página recorrida en producción" : `${list.length} páginas recorridas en producción`,
    severity: "info",
    passed: !f.some((x) => !x.passed),
    detail: f.length ? `${f.length} con errores.` : list.length === 1 ? "Responde sin errores." : "Todas responden sin errores.",
  });
  return f;
}

async function ciFinding(repo: Repo, sha: string): Promise<Finding> {
  const ci = await repo.getCiState(sha).catch(() => null);
  if (!ci || ci.state === "none" || ci.state === "pending") {
    return { id: "ci", title: "CI de la rama principal", severity: "info", passed: true, detail: ci?.state === "pending" ? "Corriendo." : "Sin pruebas configuradas en CI." };
  }
  return {
    id: "ci",
    title: ci.state === "failure" ? `La rama principal no pasa CI (${ci.failed.join(", ")})` : "La rama principal pasa CI",
    severity: "alto",
    passed: ci.state === "success",
    detail: ci.state === "failure" ? (ci.details ? `Fallos:\n${ci.details.slice(0, 600)}` : "Las pruebas o el build fallan en el último commit.") : "Pruebas, typecheck y build en verde.",
    fix: ci.state === "failure" ? "Reproducir el fallo de CI y corregir el código hasta que la rama vuelva a verde." : undefined,
  };
}

const REVIEW = `Eres Fixie y revisas SOLO el diff del día de una app web (Next.js/React/TypeScript) en busca de bugs reales
que vayan a fallar en producción: excepciones, condiciones invertidas, await faltante, null/undefined sin manejar,
rutas o imports rotos, estados de React mal actualizados, consultas que fallan, datos que se pierden.
No reportes estilo, gustos, nombres ni posibles mejoras. Si no estás seguro de que sea un bug, no lo reportes.
Lista vacía si no hay bugs. Escribe en español.`;

type Payer = Pick<ProjectRow, "id" | "owner_id">;

async function diffFindings(repo: Repo, base: string, head: string, project: Payer): Promise<{ findings: Finding[]; reviewed: number }> {
  const { files } = await repo.compare(base, head);
  const code = files.filter((x) => x.patch && /\.(tsx?|jsx?|mjs)$/.test(x.filename) && !/(^|\/)(tests?|__tests__)\//.test(x.filename));
  if (code.length === 0) return { findings: [], reviewed: 0 };
  let diff = "";
  let included = 0;
  for (const x of code) {
    const part = `--- ${x.filename}\n${x.patch}\n`;
    if (diff.length + part.length > MAX_DIFF) break;
    diff += part;
    included++;
  }
  // Un solo archivo más grande que el límite: no se manda un prompt vacío al modelo.
  if (included === 0) return { findings: [], reviewed: 0 };
  const out = await askStructured({
    name: "reportar_bugs",
    description: "Reporta los bugs encontrados en el diff (lista vacía si no hay).",
    schema: z.object({
      bugs: z
        .array(
          z.object({
            archivo: z.string(),
            linea: z.number().int().optional(),
            titulo: z.string().max(120),
            detalle: z.string().max(500).describe("Qué falla, cuándo y qué ve el usuario"),
            gravedad: z.enum(["critico", "alto", "medio"]),
          }),
        )
        .max(8),
    }),
    instructions: REVIEW,
    prompt: diff,
    fast: true,
    usage: { project, kind: "daily_review" },
  });
  const findings: Finding[] = (out?.bugs ?? []).map((b) => ({
    id: `bug:${b.archivo}:${b.titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
    title: b.titulo,
    severity: b.gravedad as Severity,
    passed: false,
    detail: `\`${b.archivo}${b.linea ? `:${b.linea}` : ""}\`. ${b.detalle}`,
    fix: "Reproducir el bug con una prueba y corregirlo.",
  }));
  return { findings, reviewed: included };
}

export async function runErrors(opts: { appUrl: string | null; repo: Repo; lastCommit: string | null; project: Payer }): Promise<ScanResult> {
  const head = await opts.repo.getDefaultBranchHead();
  const findings: Finding[] = [];
  if (opts.appUrl) findings.push(...(await crawl(opts.appUrl)));
  findings.push(await ciFinding(opts.repo, head.sha));

  let reviewed = 0;
  // Si la revisión con IA no se hizo, el diff se guarda para la próxima: no se pierde ningún cambio.
  let reviewedUpTo = head.sha;
  let paused: string | null = null;
  let failed = false as boolean;
  const changed = !!opts.lastCommit && opts.lastCommit !== head.sha;
  if (changed && hasModelKey()) {
    const r = await diffFindings(opts.repo, opts.lastCommit!, head.sha, opts.project).catch((err: unknown) => {
      if (err instanceof BudgetExceededError) paused = err.message;
      else failed = true;
      // Si el commit anterior ya no existe (force-push), compararlo fallaría siempre:
      // se sigue desde el actual en vez de quedar atascado.
      const gone = err instanceof GitHubError && (err.status === 404 || err.status === 422);
      if (!gone) reviewedUpTo = opts.lastCommit!;
      return { findings: [], reviewed: 0 };
    });
    findings.push(...r.findings);
    reviewed = r.reviewed;
  }
  findings.push({
    id: "diff-review",
    title: "Revisión con IA de los cambios del día",
    severity: "info",
    passed: true,
    detail: paused
      ? `En pausa. ${paused}`
      : failed
        ? "No se pudo revisar el diff esta vez. Fixie lo vuelve a intentar en la próxima revisión."
        : !opts.lastCommit
          ? "Primera revisión: desde mañana Fixie revisa solo lo que cambie."
          : reviewed
            ? `${reviewed} archivos cambiados revisados.`
            : changed && !hasModelKey()
              ? "Sin modelo de IA configurado: no se revisaron los cambios."
              : "Sin cambios de código desde la revisión anterior (cero tokens).",
  });

  const failing = findings.some((f) => !f.passed && f.severity !== "info");
  return { status: "ok", score: scoreOf(findings), summary: failing ? summaryOf(findings) : "Sin errores.", findings, meta: { commit: reviewedUpTo, pages: findings.find((f) => f.id === "crawl")?.title ?? null } };
}
