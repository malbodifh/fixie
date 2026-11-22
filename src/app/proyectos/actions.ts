"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { describeUrl, isPostgresUrl, testConnection } from "@/lib/clientdb";
import { decrypt, encrypt } from "@/lib/crypto";
import { canPush } from "@/lib/github";
import { createBackup, getOwnedProject, insertProject, projectContext, rotateIngestKey, updateProject } from "@/lib/projects";
import { kickMotor } from "@/lib/motor";
import { startChosenRepair, startRepairIfNeeded } from "@/lib/repairs";
import { latestScans, runScan, verifyOwnership } from "@/lib/scans";
import { DEEP_SECRET, deepSetup, installDeepWorkflow, setRepoSecret } from "@/lib/scans/shannon";
import type { ScanKind } from "@/lib/scans/common";
import { requireUserRow } from "@/lib/session";

export type ActionState = { ok?: boolean; error?: string; message?: string; key?: string; id?: string } | null;

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function text(form: FormData, name: string, max = 500): string {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

function parseAppUrl(raw: string): string | null | Error {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error();
    return u.origin;
  } catch {
    return new Error("La URL de producción debe empezar con https://");
  }
}

/** Valida la conexión antes de guardarla: si no conecta, no se guarda. */
async function checkDatabase(raw: string): Promise<{ url: string; label: string; tables: number } | Error> {
  if (!isPostgresUrl(raw)) return new Error("La conexión debe ser una URL de Postgres (postgresql://…).");
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
  const appUrl = parseAppUrl(text(form, "appUrl"));
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
  const project = await getOwnedProject(user.id, projectId);
  if (!project) throw new Error("Proyecto no encontrado");
  return { user, project };
}

export async function updateSettingsAction(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await owned(projectId);
  const name = text(form, "name", 60);
  const appUrl = parseAppUrl(text(form, "appUrl"));
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

/** Solo olvida la conexión en Autosana. No toca la base de datos del cliente. */
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

export async function runScanAction(projectId: string, kind: ScanKind): Promise<ActionState> {
  const { project } = await owned(projectId);
  const scan = await runScan(project, kind);
  // Lo que se arregla con código, Fixie lo repara solo: reparación en el entorno de pruebas.
  const repair = await startRepairIfNeeded(project, scan).catch(() => null);
  if (repair) after(withMotor(project.id, repair));
  refresh();
  if (scan.status === "error") return { error: scan.summary };
  if (scan.status === "running") return { ok: true, message: "Shannon empezó. Te avisamos aquí cuando termine; Fixie repara lo que encuentre." };
  return repair ? { ok: true, message: "Fixie empezó a reparar los hallazgos en el entorno de pruebas." } : { ok: true };
}

/** Repara ya los hallazgos del último análisis (normalmente arranca solo tras analizar). */
export async function repairNowAction(projectId: string, kind: ScanKind): Promise<ActionState> {
  const { project } = await owned(projectId);
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

// ── Conversión: el usuario elige qué cambios aplicar ──────────

export async function applyChosenAction(projectId: string, ids: string[]): Promise<ActionState> {
  const { project } = await owned(projectId);
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
 * Activa el pentest profundo: guarda la clave del modelo (y, opcional, las
 * variables del entorno de pruebas) como secretos cifrados del repo e instala el
 * workflow. Fixie no guarda ninguno de los dos valores.
 */
export async function enableDeepAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { project } = await owned(projectId);
  const apiKey = String(form.get("apiKey") ?? "").trim();
  const testEnv = String(form.get("testEnv") ?? "").trim();
  try {
    const { repo } = await projectContext(project);
    const setup = await deepSetup(repo);
    if (!setup.secret && !apiKey) return { error: "Pega la clave de tu proveedor de IA (Anthropic, OpenAI…)." };
    if (apiKey) await setRepoSecret(repo, DEEP_SECRET, apiKey);
    if (testEnv) await setRepoSecret(repo, "FIXIE_TEST_ENV", testEnv);
    if (!setup.workflow) await installDeepWorkflow(repo);
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
