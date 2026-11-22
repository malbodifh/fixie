import { notFound, redirect } from "next/navigation";
import { signInWithGitHubToken } from "@/lib/auth";
import { env } from "@/lib/env";

/** Solo en desarrollo, sin OAuth App: entra con DEV_GITHUB_TOKEN. En producción no existe. */
export async function GET() {
  const token = env.devGithubToken();
  if (!token) notFound();
  await signInWithGitHubToken(token);
  redirect("/proyectos");
}
