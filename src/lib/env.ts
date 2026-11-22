import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const env = {
  /** Clave maestra del servidor: cifra tokens y conexiones, firma la sesión. */
  secret: () => required("AUTOSANA_SECRET"),
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),
  githubClientId: () => process.env.GITHUB_CLIENT_ID ?? null,
  githubClientSecret: () => required("GITHUB_CLIENT_SECRET"),
  /** URL pública de Autosana (callback de OAuth y snippet de instalación). */
  baseUrl: () => (process.env.AUTOSANA_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** Solo en desarrollo: entrar con un token de GitHub sin OAuth App. */
  devGithubToken: () => (process.env.NODE_ENV === "development" ? (process.env.DEV_GITHUB_TOKEN ?? null) : null),
  cronSecret: () => process.env.CRON_SECRET ?? null,
};
