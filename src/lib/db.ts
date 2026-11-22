import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

// Base de datos propia de Autosana (usuarios, proyectos, respaldos).
// Solo el servidor la toca, con la clave secreta; RLS bloquea todo lo demás.

export type UserRow = {
  id: string;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  github_token_enc: string;
};

export type ProjectRow = {
  id: string;
  owner_id: string;
  name: string;
  repo: string;
  app_url: string | null;
  ingest_key_hash: string;
  ingest_key_hint: string;
  db_url_enc: string | null;
  db_label: string | null;
  auto_merge: boolean;
  verified_at: string | null;
  /** Mientras el motor empuja las reparaciones, hasta cuándo es suyo el proyecto. */
  motor_lease?: string | null;
  created_at: string;
};

export type BackupRow = {
  id: string;
  project_id: string;
  reason: "semanal" | "antes_de_cambio" | "manual";
  incident: number | null;
  storage_path: string;
  tables: number;
  rows: number;
  bytes: number;
  created_at: string;
};

export type DbChangeRow = {
  id: string;
  project_id: string;
  incident: number;
  sql: string;
  reason: string;
  status: "probado" | "aplicado" | "rechazado" | "requiere_humano";
  backup_id: string | null;
  error: string | null;
  created_at: string;
  applied_at: string | null;
};

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  client ??= createClient(env.supabaseUrl(), env.supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Lanza si Supabase devolvió error; si no, devuelve los datos. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Supabase: ${res.error.message}`);
  return res.data as T;
}
