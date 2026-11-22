import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";

/** Redirige a GitHub. Permisos: leer el perfil y escribir en repos (issues, ramas y PRs). */
export async function GET() {
  const clientId = env.githubClientId();
  if (!clientId) redirect(env.devGithubToken() ? "/api/auth/dev" : "/?error=oauth");

  const state = randomToken();
  (await cookies()).set("autosana_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: process.env.NODE_ENV === "production" });

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${env.baseUrl()}/api/auth/callback`);
  url.searchParams.set("scope", "repo workflow read:user");
  url.searchParams.set("state", state);
  redirect(url.toString());
}
