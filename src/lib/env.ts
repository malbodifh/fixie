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
  /**
   * URL pública de Fixie (callback de OAuth, snippet de instalación, motor y revisión diaria).
   * En producción nunca cae a localhost: sin ella, el motor se llamaría a una dirección que no existe.
   */
  baseUrl: () => {
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const url = process.env.AUTOSANA_BASE_URL ?? (vercel ? `https://${vercel}` : null);
    if (url) return url.replace(/\/$/, "");
    if (process.env.NODE_ENV === "production") throw new Error("Falta la variable de entorno AUTOSANA_BASE_URL");
    return "http://localhost:3000";
  },
  /** Solo en desarrollo: entrar con un token de GitHub sin OAuth App. */
  devGithubToken: () => (process.env.NODE_ENV === "development" ? (process.env.DEV_GITHUB_TOKEN ?? null) : null),
  cronSecret: () => process.env.CRON_SECRET ?? null,
};
