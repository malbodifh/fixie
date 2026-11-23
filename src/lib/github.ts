import "server-only";
import type { PullFile } from "./model";

export type { PullFile } from "./model";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** El campo `message` de la respuesta de GitHub, si lo trae. */
    readonly apiMessage: string | null = null,
  ) {
    super(message);
  }
}

async function send(token: string, url: string, init: RequestInit & { raw?: boolean } = {}): Promise<Response> {
  const { raw, ...rest } = init;
  const res = await fetch(url.startsWith("http") ? url : `${API}${url}`, {
    ...rest,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(rest.body ? { "content-type": "application/json" } : {}),
      ...rest.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let apiMessage: string | null = null;
    try {
      apiMessage = (JSON.parse(text) as { message?: string }).message ?? null;
    } catch {}
    throw new GitHubError(`GitHub ${rest.method ?? "GET"} ${url}: ${res.status} ${text.slice(0, 300)}`, res.status, apiMessage);
  }
  return res;
}

async function call<T>(token: string, url: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
  const res = await send(token, url, init);
  if (res.status === 204) return undefined as T;
  return (init.raw ? res.text() : res.json()) as Promise<T>;
}

/**
 * GET de una lista, siguiendo la paginación (encabezado Link) hasta `maxPages`.
 * Solo sigue enlaces de la API de GitHub: el token nunca sale a otro host.
 */
async function callPages<T>(token: string, url: string, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < maxPages; page++) {
    const res = await send(token, next);
    out.push(...((await res.json()) as T[]));
    const link: string | null = res.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    next = link?.startsWith(`${API}/`) ? link : null;
  }
  return out;
}

// ── Cuenta del usuario (login y elegir repos) ─────────────────

export type GitHubUser = { id: number; login: string; name: string | null; avatar_url: string };
export type GitHubRepoSummary = { full_name: string; private: boolean; pushed_at: string; permissions?: { push: boolean } };

export function getAuthenticatedUser(token: string): Promise<GitHubUser> {
  return call<GitHubUser>(token, "/user");
}

/** Repos donde el usuario puede escribir, más recientes primero. */
export async function listWritableRepos(token: string): Promise<string[]> {
  const repos = await call<GitHubRepoSummary[]>(token, "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member");
  return repos.filter((r) => r.permissions?.push !== false).map((r) => r.full_name);
}

export async function exchangeOAuthCode(opts: { clientId: string; clientSecret: string; code: string; redirectUri: string }): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
    cache: "no-store",
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!data.access_token) throw new Error(data.error_description ?? "GitHub no devolvió token");
  return data.access_token;
}

// ── Un repo concreto ──────────────────────────────────────────

export type Issue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  state_reason?: "completed" | "not_planned" | "reopened" | null;
  created_at: string;
  html_url: string;
};

export type Comment = { id: number; body: string; created_at: string };

export type PullRequest = {
  number: number;
  html_url: string;
  state: "open" | "closed";
  merged: boolean;
  merge_commit_sha: string | null;
  /** null mientras GitHub todavía calcula si se puede mergear. */
  mergeable?: boolean | null;
  head: { sha: string; ref: string };
  base: { ref: string };
};

export type CiState = "pending" | "success" | "failure" | "none";

export type WorkflowRun = {
  id: number;
  display_title: string;
  status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
};

export const INCIDENT_LABEL = "autosana";

export class Repo {
  constructor(
    readonly fullName: string,
    private readonly token: string,
  ) {}

  private gh<T>(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
    return call<T>(this.token, `/repos/${this.fullName}${path}`, init);
  }

  private ghPages<T>(path: string, maxPages: number): Promise<T[]> {
    return callPages<T>(this.token, `/repos/${this.fullName}${path}`, maxPages);
  }

  // Repo y archivos

  async getDefaultBranchHead(): Promise<{ branch: string; sha: string }> {
    const repo = await this.gh<{ default_branch: string }>("");
    const ref = await this.gh<{ object: { sha: string } }>(`/git/ref/heads/${repo.default_branch}`);
    return { branch: repo.default_branch, sha: ref.object.sha };
  }

  async getBranchHead(branch: string): Promise<string> {
    const ref = await this.gh<{ object: { sha: string } }>(`/git/ref/heads/${branch}`);
    return ref.object.sha;
  }

  /**
   * Archivos del repo en un commit. En repos muy grandes GitHub corta la lista
   * (`truncated`): quien la use no debe tratar un archivo ausente como inexistente.
   */
  async listFiles(sha: string): Promise<{ paths: string[]; truncated: boolean }> {
    const tree = await this.gh<{ tree: { path: string; type: string }[]; truncated?: boolean }>(`/git/trees/${sha}?recursive=1`);
    return { paths: tree.tree.filter((e) => e.type === "blob").map((e) => e.path), truncated: tree.truncated === true };
  }

  readFile(path: string, ref: string): Promise<string> {
    return this.gh<string>(`/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`, { raw: true });
  }

  /** Crea un commit con archivos completos sobre `parentSha`. No mueve ninguna rama. */
  async createCommit(parentSha: string, message: string, files: { path: string; content: string }[]): Promise<string> {
    const parent = await this.gh<{ tree: { sha: string } }>(`/git/commits/${parentSha}`);
    const tree = await this.gh<{ sha: string }>("/git/trees", {
      method: "POST",
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
      }),
    });
    const commit = await this.gh<{ sha: string }>("/git/commits", {
      method: "POST",
      body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
    });
    return commit.sha;
  }

  async createBranch(branch: string, sha: string): Promise<void> {
    await this.gh("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) });
  }

  /** Avanza una rama (sin forzar: solo fast-forward). */
  async moveBranch(branch: string, sha: string): Promise<void> {
    await this.gh(`/git/refs/heads/${branch}`, { method: "PATCH", body: JSON.stringify({ sha, force: false }) });
  }

  // Issues: la base de datos de incidentes vive en el propio repo

  /**
   * Issues de Fixie, más recientes primero. Los abiertos se leen todos (el motor
   * y la deduplicación de incidentes los necesitan completos); el historial, las
   * últimas 300. `since` filtra por última actualización.
   */
  listIncidentIssues(state: "open" | "closed" | "all" = "all", opts: { since?: string } = {}): Promise<Issue[]> {
    const since = opts.since ? `&since=${encodeURIComponent(opts.since)}` : "";
    return this.ghPages<Issue>(`/issues?labels=${INCIDENT_LABEL}&state=${state}&per_page=100&sort=created&direction=desc${since}`, state === "open" ? 10 : 3);
  }

  getIssue(n: number): Promise<Issue> {
    return this.gh<Issue>(`/issues/${n}`);
  }

  createIssue(title: string, body: string): Promise<Issue> {
    return this.gh<Issue>("/issues", { method: "POST", body: JSON.stringify({ title, body, labels: [INCIDENT_LABEL] }) });
  }

  closeIssue(n: number): Promise<Issue> {
    return this.gh<Issue>(`/issues/${n}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "not_planned" }) });
  }

  reopenIssue(n: number): Promise<Issue> {
    return this.gh<Issue>(`/issues/${n}`, { method: "PATCH", body: JSON.stringify({ state: "open" }) });
  }

  /** Todos los comentarios (cada paso es uno; un error frecuente suma muchos "volvió a ocurrir"). */
  listComments(n: number): Promise<Comment[]> {
    return this.ghPages<Comment>(`/issues/${n}/comments?per_page=100`, 30);
  }

  addComment(n: number, body: string): Promise<Comment> {
    return this.gh<Comment>(`/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body }) });
  }

  // Pull requests y CI

  createPullRequest(opts: { head: string; base: string; title: string; body: string }): Promise<PullRequest> {
    return this.gh<PullRequest>("/pulls", { method: "POST", body: JSON.stringify(opts) });
  }

  closePullRequest(n: number): Promise<PullRequest> {
    return this.gh<PullRequest>(`/pulls/${n}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
  }

  getPullRequest(n: number): Promise<PullRequest> {
    return this.gh<PullRequest>(`/pulls/${n}`);
  }

  listPullFiles(n: number): Promise<PullFile[]> {
    return this.gh<PullFile[]>(`/pulls/${n}/files?per_page=100`);
  }

  /** Squash merge. Con `sha`, GitHub responde 409 si la rama cambió desde ese commit (no se mergea nada sin revisar). */
  async mergePullRequest(n: number, title: string, sha?: string): Promise<string> {
    const res = await this.gh<{ sha: string }>(`/pulls/${n}/merge`, {
      method: "PUT",
      body: JSON.stringify({ merge_method: "squash", commit_title: title, ...(sha ? { sha } : {}) }),
    });
    return res.sha;
  }

  /** Estado combinado de los check runs de un commit, con los mensajes de fallo. */
  async getCiState(sha: string): Promise<{ state: CiState; failed: string[]; details: string }> {
    // Dos fuentes de CI: los check runs (GitHub Actions y apps nuevas) y los estados de
    // commit clásicos (CircleCI, Jenkins, Travis…). Un repo puede usar solo una de las dos.
    const [data, combined] = await Promise.all([
      this.gh<{ check_runs: { id: number; name: string; status: string; conclusion: string | null }[] }>(`/commits/${sha}/check-runs?per_page=50`),
      this.gh<{ statuses: { context: string; state: string; description: string | null }[] }>(`/commits/${sha}/status?per_page=100`).catch(() => ({ statuses: [] })),
    ]);
    const runs = data.check_runs;
    const statuses = combined.statuses;
    if (runs.length === 0 && statuses.length === 0) return { state: "none", failed: [], details: "" };
    const bad = runs.filter((r) => r.status === "completed" && !["success", "skipped", "neutral"].includes(r.conclusion ?? ""));
    const badStatuses = statuses.filter((s) => s.state === "failure" || s.state === "error");
    if (bad.length > 0 || badStatuses.length > 0) {
      const notes = await Promise.all(
        bad.slice(0, 2).map((r) =>
          this.gh<{ message: string; path: string; start_line: number }[]>(`/check-runs/${r.id}/annotations`).catch(() => []),
        ),
      );
      const details = [
        ...notes.flat().map((a) => `${a.path}:${a.start_line} ${a.message}`),
        ...badStatuses.map((s) => `${s.context}: ${s.description ?? s.state}`),
      ]
        .join("\n")
        .slice(0, 3000);
      return { state: "failure", failed: [...bad.map((r) => r.name), ...badStatuses.map((s) => s.context)], details };
    }
    if (runs.some((r) => r.status !== "completed") || statuses.some((s) => s.state === "pending")) return { state: "pending", failed: [], details: "" };
    return { state: "success", failed: [], details: "" };
  }

  /** Archivos cambiados entre dos commits, con su parche. */
  async compare(base: string, head: string): Promise<{ commits: number; files: PullFile[] }> {
    const data = await this.gh<{ total_commits: number; files?: PullFile[] }>(`/compare/${base}...${head}`);
    return { commits: data.total_commits, files: data.files ?? [] };
  }

  /** ¿`head` ya incluye el commit `ancestor`? (producción puede ir varios commits por delante del merge) */
  async includesCommit(head: string, ancestor: string): Promise<boolean> {
    const data = await this.gh<{ status: string }>(`/compare/${encodeURIComponent(ancestor)}...${encodeURIComponent(head)}?per_page=1`);
    return data.status === "identical" || data.status === "ahead";
  }

  // GitHub Actions: secretos, workflows y artefactos (pentest profundo)

  getActionsPublicKey(): Promise<{ key_id: string; key: string }> {
    return this.gh("/actions/secrets/public-key");
  }

  /** Guarda un secreto ya cifrado con la llave pública del repo. */
  async putSecret(name: string, encryptedValue: string, keyId: string): Promise<void> {
    await this.gh(`/actions/secrets/${name}`, { method: "PUT", body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId }) });
  }

  async hasSecret(name: string): Promise<boolean> {
    return this.gh(`/actions/secrets/${name}`).then(
      () => true,
      (err) => (err instanceof GitHubError && err.status === 404 ? false : Promise.reject(err)),
    );
  }

  /** Variable de Actions (no secreta): la crea o la actualiza. */
  async setVariable(name: string, value: string): Promise<void> {
    await this.gh(`/actions/variables/${name}`, { method: "PATCH", body: JSON.stringify({ name, value }) }).catch((err) =>
      err instanceof GitHubError && err.status === 404
        ? this.gh("/actions/variables", { method: "POST", body: JSON.stringify({ name, value }) })
        : Promise.reject(err),
    );
  }

  async getVariable(name: string): Promise<string | null> {
    return this.gh<{ value: string }>(`/actions/variables/${name}`).then(
      (v) => v.value,
      (err) => (err instanceof GitHubError && err.status === 404 ? null : Promise.reject(err)),
    );
  }

  async dispatchWorkflow(file: string, ref: string, inputs: Record<string, string>): Promise<void> {
    await this.gh(`/actions/workflows/${file}/dispatches`, { method: "POST", body: JSON.stringify({ ref, inputs }) });
  }

  async listWorkflowRuns(file: string): Promise<WorkflowRun[]> {
    const data = await this.gh<{ workflow_runs: WorkflowRun[] }>(`/actions/workflows/${file}/runs?per_page=20`);
    return data.workflow_runs;
  }

  getWorkflowRun(id: number): Promise<WorkflowRun> {
    return this.gh(`/actions/runs/${id}`);
  }

  async listRunArtifacts(runId: number): Promise<{ id: number; name: string; size_in_bytes: number; expired: boolean }[]> {
    const data = await this.gh<{ artifacts: { id: number; name: string; size_in_bytes: number; expired: boolean }[] }>(`/actions/runs/${runId}/artifacts`);
    return data.artifacts;
  }

  /** El zip de un artefacto (GitHub redirige a una URL firmada). */
  async downloadArtifact(id: number): Promise<Uint8Array> {
    const res = await fetch(`${API}/repos/${this.fullName}/actions/artifacts/${id}/zip`, {
      headers: { authorization: `Bearer ${this.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      cache: "no-store",
    });
    if (!res.ok) throw new GitHubError(`GitHub artefacto ${id}: ${res.status}`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** ¿El token puede escribir en el repo? (issues, ramas y PRs) */
export async function canPush(token: string, fullName: string): Promise<boolean> {
  try {
    const repo = await call<{ permissions?: { push?: boolean } }>(token, `/repos/${fullName}`);
    return repo.permissions?.push === true;
  } catch {
    return false;
  }
}
