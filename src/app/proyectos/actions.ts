"use server";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { refresh } from "next/cache";
import { after } from "next/server";
import { describeUrl, isPostgresUrl, testConnection } from "@/lib/clientdb";
import { decrypt, encrypt } from "@/lib/crypto";
import { canPush } from "@/lib/github";
import { createBackup, getOwnedProject, insertProject, projectContext, rotateIngestKey, updateProject } from "@/lib/projects";
import { kickMotor } from "@/lib/motor";
import { coversKnownVulns, KNOWN_VULNS_UPSELL } from "@/lib/plans";
import { retryIncident } from "@/lib/retry";
import { startChosenRepair, startNextRepair, startRepairIfNeeded } from "@/lib/repairs";
import { latestScans, runScan, verifyOwnership } from "@/lib/scans";
import { DEEP_MODEL_VAR, DEEP_SECRET, deepSetup, installDeepWorkflow, pointsToProduction, setRepoSecret, syncTestSchema } from "@/lib/scans/shannon";
import { DEFAULT_SHANNON_MODEL, shannonModel } from "@/lib/shannon-models";
import type { ScanKind } from "@/lib/scans/common";
import { requireUserRow } from "@/lib/session";

export type ActionState = { ok?: boolean; error?: string; message?: string; key?: string; id?: string } | null;

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function text(form: FormData, name: string, max = 500): string {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

// Redes internas: el servidor de Fixie nunca se conecta a ellas por un proyecto
// (ni a su propia red, ni a la de su proveedor de nube).
const INTERNAL = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) INTERNAL.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) INTERNAL.addSubnet(net, prefix, "ipv6");

/**
 * ¿El host apunta a una red interna? Se revisa el nombre y a qué IP resuelve.
 * En desarrollo se permite (la app y la base de pruebas viven en localhost).
 */
async function isInternalHost(hostname: string): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return false;
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host.startsWith("/")) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
  const family = isIP(host);
  const ips = family ? [{ address: host, family }] : await lookup(host, { all: true }).catch(() => []);
  return ips.some(({ address, family: f }) => INTERNAL.check(address, f === 6 ? "ipv6" : "ipv4"));
}

async function parseAppUrl(raw: string): Promise<string | null | Error> {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error();
  } catch {
    return new Error("La URL de producción debe empezar con https://");
  }
  if (await isInternalHost(u.hostname)) return new Error("La URL de producción debe ser pública: Fixie no analiza direcciones internas.");
  return u.origin;
}

/** Valida la conexión antes de guardarla: si no conecta, no se guarda. */
async function checkDatabase(raw: string): Promise<{ url: string; label: string; tables: number } | Error> {
  if (!isPostgresUrl(raw)) return new Error("La conexión debe ser una URL de Postgres (postgresql://…).");
  // pg también acepta el host en ?host= (incluso un socket local): se revisan todos.
  const u = new URL(raw);
  for (const host of [u.hostname, ...u.searchParams.getAll("host")]) {
    if (await isInternalHost(host)) return new Error("La base de datos debe tener una dirección pública: Fixie no se conecta a redes internas.");
  }
  try {
    const { tables } = await testConnection(raw);
    return { url: raw, label: describeUrl(raw), tables };
  } catch (err) {
    return new Error(`No pude conectar a la base de datos: ${err instanceof Error ? err.message : err}`);
  }
}

export async function createProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUserRow();
  const name = text(form, "name", 60);
  const repo = text(form, "repo", 140);
  const appUrl = await parseAppUrl(text(form, "appUrl"));
  const dbRaw = text(form, "dbUrl", 1000);

  if (!name) return { error: "Ponle un nombre al proyecto." };
  if (!REPO.test(repo)) return { error: "Elige un repositorio de GitHub." };
  if (appUrl instanceof Error) return { error: appUrl.message };
  if (!(await canPush(decrypt(user.github_token_enc), repo))) return { error: `Tu cuenta no puede escribir en ${repo}.` };

  const database = dbRaw ? await checkDatabase(dbRaw) : null;
  if (database instanceof Error) return { error: database.message };

  const { project, key } = await insertProject(user.id, {
    name,
    repo,
    appUrl,
    dbUrl: database?.url ?? null,
    dbLabel: database?.label ?? null,
    autoMerge: form.get("autoMerge") === "on",
  });
  return { ok: true, id: project.id, key };
}

async function owned(projectId: string) {
  const user = await requireUserRow();
  // Los argumentos de una acción llegan del cliente tal cual: no se confía en su tipo.
  const project = typeof projectId === "string" ? await getOwnedProject(user.id, projectId) : null;
  if (!project) throw new Error("Proyecto no encontrado");
  return { user, project };
}

export async function updateSettingsAction(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await owned(projectId);
  const name = text(form, "name", 60);
  const appUrl = await parseAppUrl(text(form, "appUrl"));
  if (!name) return { error: "El nombre no puede quedar vacío." };
  if (appUrl instanceof Error) return { error: appUrl.message };
  await updateProject(user.id, projectId, { name, app_url: appUrl, auto_merge: form.get("autoMerge") === "on" });
  refresh();
  return { ok: true, message: "Guardado." };
}

export async function linkDatabaseAction(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await owned(projectId);
  const database = await checkDatabase(text(form, "dbUrl", 1000));
  if (database instanceof Error) return { error: database.message };
  await updateProject(user.id, projectId, { db_url_enc: encrypt(database.url), db_label: database.label });
  refresh();
  return { ok: true, message: `Conectada: ${database.tables} tablas visibles.` };
}

/** Solo olvida la conexión en Fixie. No toca la base de datos del cliente. */
export async function unlinkDatabaseAction(projectId: string): Promise<ActionState> {
  const { user } = await owned(projectId);
  await updateProject(user.id, projectId, { db_url_enc: null, db_label: null });
  refresh();
  return { ok: true, message: "Base de datos desvinculada." };
}

export async function rotateKeyAction(projectId: string): Promise<ActionState> {
  const { user } = await owned(projectId);
  const key = await rotateIngestKey(user.id, projectId);
  refresh();
  return { ok: true, key };
}

export async function backupNowAction(projectId: string): Promise<ActionState> {
  const { project } = await owned(projectId);
  try {
    const backup = await createBackup(await projectContext(project), "manual");
    refresh();
    return { ok: true, message: `Respaldo listo: ${backup.tables} tablas, ${backup.rows} filas.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No pude respaldar." };
  }
}

// ── Análisis: pentesting, conversión y Lighthouse ─────────────

const SCAN_KINDS: readonly ScanKind[] = ["errors", "pentest", "pentest_deep", "conversion", "lighthouse", "deps"];
const isScanKind = (v: unknown): v is ScanKind => SCAN_KINDS.includes(v as ScanKind);

export async function runScanAction(projectId: string, kind: ScanKind): Promise<ActionState> {
  const { user, project } = await owned(projectId);
  if (!isScanKind(kind)) return { error: "Tipo de análisis desconocido." };
  if (kind === "deps" && !coversKnownVulns(user.plan)) return { error: KNOWN_VULNS_UPSELL };
  let scan: Awaited<ReturnType<typeof runScan>>;
  try {
    scan = await runScan(project, kind);
  } catch (err) {
    // Sin esto, el error sube al límite de errores de React y tumba la página.
    return { error: err instanceof Error ? err.message : "No pude analizar." };
  }
  // Lo que se arregla con código, Fixie lo repara solo: reparación en el entorno de pruebas.
  const repair = await startRepairIfNeeded(project, scan).catch(() => null);
  if (repair) after(withMotor(project.id, repair));
  refresh();
  if (scan.status === "error") return { error: scan.summary };
  if (scan.status === "running") return { ok: true, message: "Shannon empezó. Te avisamos aquí cuando termine; Fixie repara lo que encuentre." };
  return repair ? { ok: true, message: "Fixie empezó a reparar los hallazgos en el entorno de pruebas." } : { ok: true };
}

/**
 * Revisión completa: las 4 pruebas a la vez (errores, pentesting, conversión y
 * Lighthouse). Después Fixie repara lo que encontró con el ciclo de siempre,
 * una reparación tras otra por prioridad, hasta el merge y la verificación.
 * Conversión solo propone: el usuario elige qué textos cambiar.
 */
export async function runFullReviewAction(projectId: string): Promise<ActionState> {
  const { project } = await owned(projectId);
  const kinds: ScanKind[] = project.app_url ? ["errors", "pentest", "conversion", "lighthouse"] : ["errors"];
  const results = await Promise.allSettled(kinds.map((kind) => runScan(project, kind)));
  const job = await startNextRepair(project).catch(() => null);
  if (job) after(withMotor(project.id, job));
  refresh();

  const failed = results.filter((r) => r.status === "rejected" || r.value.status === "error").length;
  const done = kinds.length - failed;
  const head = project.app_url ? `${done} de 4 pruebas listas.` : "Errores revisados. Agrega la URL de producción para correr las otras 3 pruebas.";
  if (job) return { ok: true, message: `${head} Fixie empezó a reparar lo que encontró y lo publica cuando el revisor lo apruebe.` };
  return failed ? { error: `${head} ${failed === 1 ? "Una prueba falló" : `${failed} pruebas fallaron`}; revisa su categoría.` } : { ok: true, message: `${head} Fixie no abrió reparaciones nuevas: no hay nada pendiente o ya lo intentó hoy.` };
}

/** Repara ya los hallazgos del último análisis (normalmente arranca solo tras analizar). */
export async function repairNowAction(projectId: string, kind: ScanKind): Promise<ActionState> {
  const { user, project } = await owned(projectId);
  if (!isScanKind(kind)) return { error: "Tipo de análisis desconocido." };
  if (kind === "deps" && !coversKnownVulns(user.plan)) return { error: KNOWN_VULNS_UPSELL };
  const scan = (await latestScans(project.id))[kind];
  if (!scan) return { error: "Primero analiza la app." };
  try {
    const repair = await startRepairIfNeeded(project, scan);
    if (!repair) return { ok: true, message: "No hay hallazgos que reparar o ya hay una reparación en curso." };
    after(withMotor(project.id, repair));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No pude empezar la reparación." };
  }
  refresh();
  return { ok: true, message: "Fixie empezó a reparar los hallazgos en el entorno de pruebas." };
}

export async function verifyOwnershipAction(projectId: string): Promise<ActionState> {
  const { project } = await owned(projectId);
  const ok = await verifyOwnership(project);
  refresh();
  return ok
    ? { ok: true, message: "Dominio verificado: el pentesting ya incluye pruebas activas." }
    : { error: "No encontré el id del proyecto en /api/autosana-verify de tu app." };
}

/** Corre el trabajo del agente y después despierta al motor, que lleva el ciclo hasta el final. */
function withMotor(projectId: string, job: () => Promise<void>) {
  return async () => {
    await job();
    await kickMotor(projectId);
  };
}

// ── Reintento manual de un incidente o reparación detenidos ──

/** "Diagnosticar y reparar": el ciclo vuelve a empezar desde cero con el estado actual del repo. */
export async function retryIncidentAction(projectId: string, issue: number): Promise<ActionState> {
  const { project } = await owned(projectId);
  // El número va a la ruta de la API de GitHub: solo un entero positivo.
  if (!Number.isSafeInteger(issue) || issue <= 0) return { error: "Número de incidente inválido." };
  try {
    const res = await retryIncident(project, issue);
    if ("error" in res) return { error: res.error };
    after(withMotor(project.id, res.job));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No pude reintentar." };
  }
  refresh();
  return { ok: true, message: "Fixie está diagnosticando y reparando." };
}

// ── Conversión: el usuario elige qué cambios aplicar ──────────

export async function applyChosenAction(projectId: string, ids: string[]): Promise<ActionState> {
  const { project } = await owned(projectId);
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((id) => typeof id === "string" && id.length <= 200)) {
    return { error: "Elige al menos un cambio." };
  }
  const scan = (await latestScans(project.id)).conversion;
  if (!scan) return { error: "Primero analiza la app." };
  try {
    const job = await startChosenRepair(project, scan, ids);
    if ("error" in job) return { error: job.error };
    after(withMotor(project.id, job));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No pude aplicar los cambios." };
  }
  refresh();
  return { ok: true, message: `Fixie está aplicando ${ids.length === 1 ? "el cambio" : `los ${ids.length} cambios`} en el entorno de pruebas.` };
}

// ── Pentest profundo (Shannon) ────────────────────────────────

/**
 * Activa el pentest profundo: guarda la clave del modelo como secreto cifrado del
 * repo, copia la estructura de la base (sin datos) para el entorno de pruebas e
 * instala el workflow, que arma ese entorno solo. Las claves de prueba de
 * servicios externos son opcionales. Fixie no guarda ningún valor.
 */
export async function enableDeepAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { project } = await owned(projectId);
  const apiKey = String(form.get("apiKey") ?? "").trim();
  const testEnv = String(form.get("testEnv") ?? "").trim();
  // GitHub acepta secretos de hasta 48 KB: mejor avisar que guardar uno recortado.
  if (apiKey.length > 1000 || testEnv.length > 40_000) return { error: "La clave o las variables son demasiado largas." };
  const model = shannonModel(String(form.get("model") ?? "")) ?? shannonModel(DEFAULT_SHANNON_MODEL)!;
  try {
    const { repo, dbUrl } = await projectContext(project);
    if (testEnv) {
      const prod = pointsToProduction(testEnv, { dbUrl, appUrl: project.app_url });
      if (prod) return { error: `No guardé las variables: ${prod} Shannon modifica datos, así que solo puede usar un entorno de pruebas.` };
    }
    const setup = await deepSetup(repo);
    const sameModel = shannonModel(setup.model)?.id === model.id;
    if (!apiKey && !(setup.secret && sameModel)) return { error: `Pega la clave de ${model.label.replace(/ \(.*\)$/, "")}.` };
    if (apiKey) await setRepoSecret(repo, DEEP_SECRET, apiKey);
    await repo.setVariable(DEEP_MODEL_VAR, model.spec);
    if (testEnv) await setRepoSecret(repo, "FIXIE_TEST_ENV", testEnv);
    if (!setup.workflow) await installDeepWorkflow(repo, setup.outdated);
    // Si falla (base sin conexión o estructura enorme), la corrida usa las migraciones del repo.
    await syncTestSchema(repo, dbUrl).catch(() => false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/workflow/i.test(msg) || / (403|404) /.test(msg)) {
      return { error: "GitHub no dejó instalar el workflow. Sal y vuelve a entrar con GitHub para dar el permiso de workflows." };
    }
    return { error: `No pude activarlo: ${msg.slice(0, 200)}` };
  }
  refresh();
  return { ok: true, message: "Pentest profundo activado. Corre cada semana; puedes lanzarlo ahora." };
}
