import "server-only";
import { encrypt } from "./crypto";
import { db, must, type UserRow } from "./db";
import { getAuthenticatedUser } from "./github";
import { startSession } from "./session";

/** Guarda (o actualiza) al usuario de GitHub con su token cifrado y abre sesión. */
export async function signInWithGitHubToken(token: string): Promise<UserRow> {
  const gh = await getAuthenticatedUser(token);
  const user = must(
    await db()
      .from("users")
      .upsert(
        {
          github_id: gh.id,
          login: gh.login,
          name: gh.name,
          avatar_url: gh.avatar_url,
          github_token_enc: encrypt(token),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "github_id" },
      )
      .select("*")
      .single<UserRow>(),
  );
  await startSession(user.id);
  return user;
}
