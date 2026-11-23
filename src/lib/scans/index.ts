import "server-only";
import { db, must, type ProjectRow } from "../db";
import { fetchApp } from "./common";
import type { Finding, ScanKind, ScanResult } from "./common";
import { runLighthouse } from "./lighthouse";
import { runPentest } from "./pentest";
import { projectContext } from "../projects";
import { runConversion } from "./conversion";
import { runDeps } from "./deps";
import { runErrors } from "./errors";
import { deepProgress, deepSetup, dispatchDeep, syncTestSchema } from "./shannon";

export type ScanRow = {
  id: string;
  project_id: string;
  kind: ScanKind;
  status: ScanResult["status"];
  score: number | null;
  summary: string;
  findings: Finding[];
  meta: Record<string, unknown>;
  created_at: string;
};

type ScanProject = ProjectRow & { verified_at?: string | null };

/** Corre un análisis sin guardarlo. Las dependencias se leen del repo; el resto, de la URL de producción. */
export async function computeScan(project: ScanProject, kind: ScanKind): Promise<ScanResult> {
  if (kind === "deps") {
    try {
      return await runDeps((await projectContext(project)).repo);
    } catch (err) {
      return { status: "error", score: null, summary: `No pude revisar las dependencias: ${err instanceof Error ? err.message : err}`, findings: [] };
    }
  }
  if (kind === "errors") {
    try {
      const last = await latestScan(project.id, "errors");
      return await runErrors({ appUrl: project.app_url, repo: (await projectContext(project)).repo, lastCommit: (last?.meta?.commit as string | undefined) ?? null, project });
    } catch (err) {
      return { status: "error", score: null, summary: `No pude buscar errores: ${err instanceof Error ? err.message : err}`, findings: [] };
    }
  }
  if (kind === "pentest_deep") throw new Error("El pentest profundo se lanza con startDeep().");
  if (!project.app_url) throw new Error("Agrega la URL de producción del proyecto en Ajustes.");
  let result: ScanResult;
  try {
    result =
      kind === "pentest"
        ? await runPentest(project.app_url, !!project.verified_at)
        : kind === "conversion"
          ? await runConversion(project.app_url, project)
          : await runLighthouse(project.app_url);
  } catch (err) {
    result = { status: "error", score: null, summary: `No pude analizar ${project.app_url}: ${err instanceof Error ? err.message : err}`, findings: [] };
  }
  return result;
}

export async function saveScan(project: ProjectRow, kind: ScanKind, result: ScanResult): Promise<ScanRow> {
  return must(
    await db()
      .from("scans")
      .insert({ project_id: project.id, kind, status: result.status, score: result.score, summary: result.summary, findings: result.findings, meta: result.meta ?? {} })
      .select("*")
      .single<ScanRow>(),
  );
}

export async function updateScan(id: string, result: ScanResult): Promise<ScanRow> {
  return must(
    await db()
      .from("scans")
      .update({ status: result.status, score: result.score, summary: result.summary, findings: result.findings, meta: result.meta ?? {} })
      .eq("id", id)
      .select("*")
      .single<ScanRow>(),
  );
}

/** Corre un análisis sobre el proyecto y guarda el resultado. El pentest profundo se lanza y termina horas después. */
export async function runScan(project: ScanProject, kind: ScanKind): Promise<ScanRow> {
  if (kind === "pentest_deep") return startDeep(project);
  return saveScan(project, kind, await computeScan(project, kind));
}

// ── Pentest profundo (Shannon en GitHub Actions) ─────────────

/** Lanza Shannon en el CI del repo. Si falta configurarlo, lo dice; si ya corre uno, lo devuelve. */
export async function startDeep(project: ScanProject): Promise<ScanRow> {
  const { repo, dbUrl } = await projectContext(project);
  const setup = await deepSetup(repo);
  if (!setup.workflow || !setup.secret) {
    return saveScan(project, "pentest_deep", {
      status: "needs_setup",
      score: null,
      summary: setup.outdated
        ? "Fixie tiene una versión nueva del pentest profundo. Pulsa Activar para actualizar el workflow de tu repo."
        : "Activa el pentest profundo: Fixie instala el workflow en tu repo y guarda la clave del modelo como secreto de GitHub.",
      findings: [],
      meta: setup,
    });
  }
  const last = await latestScan(project.id, "pentest_deep");
  if (last?.status === "running") return last;
  const row = await saveScan(project, "pentest_deep", {
    status: "running",
    score: null,
    summary: "Shannon está atacando una copia de tu app dentro de GitHub Actions. Puede tardar unas horas.",
    findings: [],
    meta: { startedAt: new Date().toISOString() },
  });
  try {
    // La estructura de producción cambia: se copia de nuevo (sin datos) antes de cada corrida.
    await syncTestSchema(repo, dbUrl).catch(() => false);
    await dispatchDeep(repo, row.id);
    return row;
  } catch (err) {
    return updateScan(row.id, { status: "error", score: null, summary: `GitHub no pudo lanzar el pentest: ${err instanceof Error ? err.message : err}`, findings: [] });
  }
}

/** Revisa una ejecución en curso. Cuando termina, guarda los hallazgos. */
export async function refreshDeep(project: ScanProject, row: ScanRow): Promise<ScanRow> {
  if (row.status !== "running") return row;
  const { repo } = await projectContext(project);
  const progress = await deepProgress(repo, row.id);
  if (progress.state === "waiting") {
    if (Date.now() - Date.parse(row.created_at) < 30 * 60_000) return row;
    return updateScan(row.id, { status: "error", score: null, summary: "GitHub Actions no inició el pentest en 30 minutos. Revisa que Actions esté habilitado en el repo.", findings: [] });
  }
  if (progress.state === "running") {
    if (row.meta.run === progress.url) return row;
    return updateScan(row.id, { status: "running", score: null, summary: row.summary, findings: [], meta: { ...row.meta, run: progress.url } });
  }
  if (progress.state === "failed") {
    return updateScan(row.id, { status: "error", score: null, summary: progress.summary, findings: [], meta: { ...row.meta, run: progress.url } });
  }
  return updateScan(row.id, { ...progress.result, meta: { ...row.meta, ...progress.result.meta } });
}

export async function latestScan(projectId: string, kind: ScanKind): Promise<ScanRow | null> {
  const [row] = must(await db().from("scans").select("*").eq("project_id", projectId).eq("kind", kind).order("created_at", { ascending: false }).limit(1)) as ScanRow[];
  return row ?? null;
}

/** El último análisis de cada tipo. */
const KINDS: ScanKind[] = ["errors", "pentest", "pentest_deep", "conversion", "lighthouse", "deps"];

export async function latestScans(projectId: string): Promise<Partial<Record<ScanKind, ScanRow>>> {
  const rows = await Promise.all(KINDS.map((kind) => latestScan(projectId, kind)));
  const out: Partial<Record<ScanKind, ScanRow>> = {};
  for (const r of rows) if (r) out[r.kind] = r;
  return out;
}

/**
 * Verificación de dueño: la app debe responder en /api/autosana-verify con el
 * id del proyecto. Habilita las pruebas activas del pentesting.
 */
export async function verifyOwnership(project: ProjectRow): Promise<boolean> {
  if (!project.app_url) return false;
  const res = await fetchApp(`${new URL(project.app_url).origin}/api/autosana-verify`).catch(() => null);
  const text = res?.ok ? (await res.text()).trim() : "";
  if (!text.includes(project.id)) return false;
  must(await db().from("projects").update({ verified_at: new Date().toISOString() }).eq("id", project.id).select("id").single());
  return true;
}
