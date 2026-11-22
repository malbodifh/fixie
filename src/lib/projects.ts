import "server-only";
import { gzipSync } from "node:zlib";
import { snapshot } from "./clientdb";
import { decrypt, encrypt, newIngestKey, sha256 } from "./crypto";
import { db, must, type BackupRow, type DbChangeRow, type ProjectRow, type UserRow } from "./db";
import { Repo } from "./github";

// ── Proyectos ─────────────────────────────────────────────────

export async function listProjects(ownerId: string): Promise<ProjectRow[]> {
  return must(await db().from("projects").select("*").eq("owner_id", ownerId).order("created_at", { ascending: false }));
}

/** Devuelve el proyecto solo si pertenece al usuario. */
export async function getOwnedProject(ownerId: string, id: string): Promise<ProjectRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db().from("projects").select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle<ProjectRow>();
  return data ?? null;
}

export type ProjectInput = { name: string; repo: string; appUrl: string | null; dbUrl: string | null; dbLabel: string | null; autoMerge: boolean };

export async function insertProject(ownerId: string, input: ProjectInput): Promise<{ project: ProjectRow; key: string }> {
  const key = newIngestKey();
  const project = must(
    await db()
      .from("projects")
      .insert({
        owner_id: ownerId,
        name: input.name,
        repo: input.repo,
        app_url: input.appUrl,
        db_url_enc: input.dbUrl ? encrypt(input.dbUrl) : null,
        db_label: input.dbLabel,
        auto_merge: input.autoMerge,
        ingest_key_hash: key.hash,
        ingest_key_hint: key.hint,
      })
      .select("*")
      .single<ProjectRow>(),
  );
  return { project, key: key.key };
}

export async function updateProject(
  ownerId: string,
  id: string,
  patch: Partial<{ name: string; app_url: string | null; db_url_enc: string | null; db_label: string | null; auto_merge: boolean }>,
): Promise<void> {
  must(await db().from("projects").update(patch).eq("id", id).eq("owner_id", ownerId).select("id").single());
}

export async function rotateIngestKey(ownerId: string, id: string): Promise<string> {
  const key = newIngestKey();
  must(
    await db()
      .from("projects")
      .update({ ingest_key_hash: key.hash, ingest_key_hint: key.hint })
      .eq("id", id)
      .eq("owner_id", ownerId)
      .select("id")
      .single(),
  );
  return key.key;
}

// ── Contexto de trabajo (repo + BD con las credenciales del dueño) ──

export type ProjectContext = { project: ProjectRow; repo: Repo; dbUrl: string | null };

async function ownerToken(ownerId: string): Promise<string> {
  const owner = must(await db().from("users").select("github_token_enc").eq("id", ownerId).single<Pick<UserRow, "github_token_enc">>());
  return decrypt(owner.github_token_enc);
}

export async function projectContext(project: ProjectRow): Promise<ProjectContext> {
  return {
    project,
    repo: new Repo(project.repo, await ownerToken(project.owner_id)),
    dbUrl: project.db_url_enc ? decrypt(project.db_url_enc) : null,
  };
}

/** Ingesta: la clave Bearer identifica al proyecto. Solo se guarda su hash. */
export async function findProjectByIngestKey(key: string): Promise<ProjectRow | null> {
  if (!key.startsWith("asn_") || key.length > 100) return null;
  const { data } = await db().from("projects").select("*").eq("ingest_key_hash", sha256(key)).maybeSingle<ProjectRow>();
  return data ?? null;
}

/** Todos los proyectos: la vigilancia de dependencias revisa cada repo. */
export async function getProjectById(id: string): Promise<ProjectRow | null> {
  const { data } = await db().from("projects").select("*").eq("id", id).maybeSingle<ProjectRow>();
  return data ?? null;
}

export async function listAllProjects(): Promise<ProjectRow[]> {
  return must(await db().from("projects").select("*"));
}

/** Proyectos con URL de producción: los que la revisión semanal analiza y repara. */
export async function listProjectsWithUrl(): Promise<ProjectRow[]> {
  return must(await db().from("projects").select("*").not("app_url", "is", null));
}

export async function listProjectsWithDb(): Promise<ProjectRow[]> {
  return must(await db().from("projects").select("*").not("db_url_enc", "is", null));
}

// ── Respaldos ─────────────────────────────────────────────────

export async function createBackup(ctx: ProjectContext, reason: BackupRow["reason"], incident?: number): Promise<BackupRow> {
  if (!ctx.dbUrl) throw new Error("El proyecto no tiene base de datos vinculada.");
  const { snapshot: snap, rows } = await snapshot(ctx.dbUrl);
  const body = gzipSync(Buffer.from(JSON.stringify(snap)));
  const path = `${ctx.project.id}/${snap.createdAt.replace(/[:.]/g, "-")}-${reason}.json.gz`;
  const upload = await db().storage.from("backups").upload(path, body, { contentType: "application/gzip", upsert: false });
  if (upload.error) throw new Error(`No pude guardar el respaldo: ${upload.error.message}`);
  return must(
    await db()
      .from("db_backups")
      .insert({ project_id: ctx.project.id, reason, incident: incident ?? null, storage_path: path, tables: snap.tables.length, rows, bytes: body.length })
      .select("*")
      .single<BackupRow>(),
  );
}

export async function listBackups(projectId: string, limit = 8): Promise<BackupRow[]> {
  return must(await db().from("db_backups").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(limit));
}

export async function backupDownloadUrl(path: string): Promise<string | null> {
  const { data } = await db().storage.from("backups").createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

// ── Cambios de estructura propuestos por la IA ────────────────

export async function recordDbChange(row: Pick<DbChangeRow, "project_id" | "incident" | "sql" | "reason" | "status" | "error">): Promise<DbChangeRow> {
  return must(await db().from("db_changes").insert(row).select("*").single<DbChangeRow>());
}

export async function getPendingDbChange(projectId: string, incident: number): Promise<DbChangeRow | null> {
  const { data } = await db()
    .from("db_changes")
    .select("*")
    .eq("project_id", projectId)
    .eq("incident", incident)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<DbChangeRow>();
  return data ?? null;
}

export async function setDbChangeStatus(id: string, patch: Partial<Pick<DbChangeRow, "status" | "backup_id" | "error" | "applied_at">>) {
  must(await db().from("db_changes").update(patch).eq("id", id).select("id").single());
}
