import "server-only";
import { unzipSync, strFromU8 } from "fflate";
import sodium from "libsodium-wrappers";
import type { Repo } from "../github";
import { scoreOf, summaryOf, type Finding, type ScanResult, type Severity } from "./common";

/**
 * Pentest profundo con Shannon (KeygraphHQ/shannon, AGPL-3.0). Fixie no
 * incluye su código: corre la GitHub Action oficial en el CI del propio repo
 * del cliente. Shannon lee el código y ataca la app levantada DENTRO del
 * runner (entorno de pruebas), nunca producción. Solo reporta lo que logró
 * explotar. Fixie lee el SARIF y repara.
 */

export const DEEP_WORKFLOW = "fixie-pentest.yml";
export const DEEP_SECRET = "SHANNON_AI_API_KEY";
const PATH = `.github/workflows/${DEEP_WORKFLOW}`;

const WORKFLOW_YAML = [
  "# Lo instala Fixie. Corre Shannon contra la app levantada en este runner,",
  "# con las variables de FIXIE_TEST_ENV (entorno de pruebas). Nunca contra producción.",
  "name: Fixie pentest profundo",
  "run-name: Fixie pentest ${{ inputs.fixie_id }}",
  "",
  "on:",
  "  workflow_dispatch:",
  "    inputs:",
  "      fixie_id:",
  "        description: Id del análisis en Fixie",
  "        required: true",
  "",
  "permissions:",
  "  contents: read",
  "",
  "jobs:",
  "  pentest:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 360",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - uses: actions/setup-node@v4",
  "        with:",
  "          node-version: 22",
  "          cache: npm",
  "      - run: npm ci",
  "      - name: Variables del entorno de pruebas",
  "        env:",
  "          FIXIE_TEST_ENV: ${{ secrets.FIXIE_TEST_ENV }}",
  "        run: if [ -n \"$FIXIE_TEST_ENV\" ]; then printf '%s\\n' \"$FIXIE_TEST_ENV\" > .env.local; fi",
  "      - run: npm run build",
  "      - name: Levantar la app en el runner",
  "        run: |",
  "          nohup npm start -- -p 3000 > app.log 2>&1 &",
  "          for i in $(seq 1 90); do curl -s -o /dev/null http://localhost:3000 && exit 0; sleep 2; done",
  "          cat app.log; exit 1",
  "      - name: Shannon",
  "        uses: KeygraphHQ/shannon-action@v1",
  "        with:",
  "          url: http://host.docker.internal:3000",
  "          api-key: ${{ secrets.SHANNON_AI_API_KEY }}",
  "          fail-on-severity: none",
  "",
].join("\n");

export type DeepSetup = { workflow: boolean; secret: boolean };

export async function deepSetup(repo: Repo): Promise<DeepSetup> {
  const head = await repo.getDefaultBranchHead();
  const [workflow, secret] = await Promise.all([
    repo.readFile(PATH, head.sha).then(
      () => true,
      () => false,
    ),
    repo.hasSecret(DEEP_SECRET).catch(() => false),
  ]);
  return { workflow, secret };
}

/** Cifra el valor con la llave pública del repo (sealed box) y lo guarda como secreto de Actions. Fixie no lo guarda. */
export async function setRepoSecret(repo: Repo, name: string, value: string): Promise<void> {
  await sodium.ready;
  const { key, key_id } = await repo.getActionsPublicKey();
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(key, sodium.base64_variants.ORIGINAL));
  await repo.putSecret(name, sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id);
}

/** Instala el workflow con un PR que se mergea en el acto (el usuario lo pidió con el botón). */
export async function installDeepWorkflow(repo: Repo): Promise<void> {
  const head = await repo.getDefaultBranchHead();
  const branch = `autosana/pentest-profundo-${Date.now().toString(36)}`;
  const sha = await repo.createCommit(head.sha, "Fixie: pentest profundo con Shannon", [{ path: PATH, content: WORKFLOW_YAML }]);
  await repo.createBranch(branch, sha);
  const pr = await repo.createPullRequest({
    head: branch,
    base: head.branch,
    title: "Fixie: activar el pentest profundo",
    body: [
      "Agrega el workflow que corre **Shannon** (KeygraphHQ/shannon) en este repo cuando Fixie lo pide.",
      "",
      "- Levanta la app dentro del runner con las variables del secreto `FIXIE_TEST_ENV` (entorno de pruebas).",
      "- Shannon lee el código y ataca esa copia local. Nunca toca producción.",
      "- Solo reporta lo que logró explotar. Fixie lee el reporte y repara cada hallazgo con su PR.",
    ].join("\n"),
  });
  await repo.mergePullRequest(pr.number, "Fixie: activar el pentest profundo");
}

/** Lanza el pentest. `fixieId` permite encontrar después la ejecución. */
export async function dispatchDeep(repo: Repo, fixieId: string): Promise<void> {
  const head = await repo.getDefaultBranchHead();
  await repo.dispatchWorkflow(DEEP_WORKFLOW, head.branch, { fixie_id: fixieId });
}

type Sarif = {
  runs?: {
    results?: {
      ruleId?: string;
      level?: string;
      message?: { text?: string; markdown?: string };
      locations?: { physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number } } }[];
      webRequest?: { method?: string; target?: string };
      properties?: { findingId?: string; status?: string; authState?: string; sastRuleId?: string };
    }[];
  }[];
};

function section(md: string, name: string): string | null {
  const m = md.match(new RegExp(`\\*\\*${name}\\*\\*\\s*\\n+([\\s\\S]*?)(?:\\n\\n\\*\\*|$)`));
  return m ? m[1].trim() : null;
}

/** Convierte el SARIF de Shannon en hallazgos de Fixie. Solo lo explotado. */
export function sarifFindings(sarif: Sarif): Finding[] {
  const out: Finding[] = [];
  for (const r of sarif.runs?.[0]?.results ?? []) {
    const status = r.properties?.status;
    if (status && status !== "exploited") continue;
    const md = r.message?.markdown ?? r.message?.text ?? "";
    const title = (md.match(/^\*\*(.+?)\*\*/)?.[1] ?? r.message?.text?.split(". ")[0] ?? r.ruleId ?? "Vulnerabilidad").slice(0, 160);
    const loc = r.locations?.[0]?.physicalLocation;
    const where = loc?.artifactLocation?.uri ? `${loc.artifactLocation.uri}${loc.region?.startLine ? `:${loc.region.startLine}` : ""}` : null;
    const unauth = /^unauth/i.test(r.properties?.authState ?? "");
    const severity: Severity = r.level === "error" ? (unauth ? "critico" : "alto") : r.level === "warning" ? "medio" : "bajo";
    const impact = section(md, "Impact");
    out.push({
      id: `shannon:${r.properties?.findingId ?? `${r.ruleId}:${where}`}`,
      title,
      severity,
      passed: false,
      detail: [
        "Explotada por Shannon en el entorno de pruebas.",
        r.webRequest?.method && r.webRequest.target ? `${r.webRequest.method} ${new URL(r.webRequest.target).pathname}.` : null,
        where ? `Código: \`${where}\`.` : null,
        r.properties?.sastRuleId ?? null,
        impact ? `Impacto: ${impact.slice(0, 400)}` : null,
      ]
        .filter(Boolean)
        .join(" "),
      fix: section(md, "Remediation")?.slice(0, 800) ?? undefined,
    });
  }
  return out;
}

export type DeepProgress =
  | { state: "waiting" }
  | { state: "running"; url: string; startedAt: string }
  | { state: "done"; url: string; result: ScanResult }
  | { state: "failed"; url: string; summary: string };

/** Estado de la ejecución de `fixieId`. Cuando termina, descarga el reporte y lo convierte. */
export async function deepProgress(repo: Repo, fixieId: string): Promise<DeepProgress> {
  const run = (await repo.listWorkflowRuns(DEEP_WORKFLOW)).find((r) => r.display_title.includes(fixieId));
  if (!run) return { state: "waiting" };
  if (run.status !== "completed") return { state: "running", url: run.html_url, startedAt: run.created_at };

  let sarif: Sarif | null = null;
  for (const a of (await repo.listRunArtifacts(run.id)).filter((x) => !x.expired && x.size_in_bytes < 60_000_000)) {
    const files = unzipSync(await repo.downloadArtifact(a.id), { filter: (f) => f.name.endsWith(".sarif") });
    const name = Object.keys(files)[0];
    if (name) {
      sarif = JSON.parse(strFromU8(files[name])) as Sarif;
      break;
    }
  }
  if (!sarif) {
    return {
      state: "failed",
      url: run.html_url,
      summary: run.conclusion === "success" ? "Shannon terminó sin reporte SARIF." : "El pentest profundo no terminó. Revisa la ejecución en GitHub Actions.",
    };
  }
  const findings = sarifFindings(sarif);
  findings.push({
    id: "shannon-run",
    title: "Pentest profundo completo",
    severity: "info",
    passed: findings.length === 0,
    detail: findings.length ? `Shannon explotó ${findings.length} vulnerabilidades.` : "Shannon no logró explotar nada.",
  });
  return {
    state: "done",
    url: run.html_url,
    result: { status: "ok", score: scoreOf(findings), summary: findings.length > 1 ? summaryOf(findings) : "Sin vulnerabilidades explotables.", findings, meta: { run: run.html_url } },
  };
}
