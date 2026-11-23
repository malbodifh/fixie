import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { signInWithGitHubToken } from "@/lib/auth";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { exchangeOAuthCode } from "@/lib/github";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const jar = await cookies();
  const expected = jar.get("autosana_oauth_state")?.value ?? "";
  jar.delete("autosana_oauth_state");
  if (!code || !expected || !safeEqual(state, expected)) redirect("/?error=oauth");

  const clientId = env.githubClientId();
  if (!clientId) redirect("/?error=oauth");
  try {
    const token = await exchangeOAuthCode({ clientId, clientSecret: env.githubClientSecret(), code, redirectUri: `${env.baseUrl()}/api/auth/callback` });
    await signInWithGitHubToken(token);
  } catch (err) {
    console.error("[fixie] login falló", err);
    redirect("/?error=oauth");
  }
  redirect("/proyectos");
}
