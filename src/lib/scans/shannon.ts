import "server-only";
import { gzipSync, strFromU8, strToU8, unzipSync } from "fflate";
import sodium from "libsodium-wrappers";
import { schemaDDL } from "../clientdb";
import type { Repo } from "../github";
import { scoreOf, summaryOf, type Finding, type ScanResult, type Severity } from "./common";
import { PREPARE_SCRIPT } from "./test-env-script";

/**
 * Pentest profundo con Shannon (KeygraphHQ/shannon, AGPL-3.0). Fixie no
 * incluye su código: corre la GitHub Action oficial en el CI del propio repo
 * del cliente. Shannon lee el código y ataca la app levantada DENTRO del
 * runner (entorno de pruebas), nunca producción. Solo reporta lo que logró
 * explotar. Fixie lee el SARIF y repara.
 */

export const DEEP_WORKFLOW = "fixie-pentest.yml";
export const DEEP_SECRET = "SHANNON_AI_API_KEY";
export const DEEP_MODEL_VAR = "FIXIE_SHANNON_MODEL";
const PATH = `.github/workflows/${DEEP_WORKFLOW}`;
const PREPARE_PATH = ".github/fixie/prepare.mjs";
/** Marca de la versión del workflow. Si el repo tiene otra, Fixie lo actualiza. */
const WORKFLOW_VERSION = "fixie-pentest v4";

const WORKFLOW_YAML = [
  `# ${WORKFLOW_VERSION}. Lo instala Fixie. Arma un entorno de pruebas desechable dentro de este runner`,
  "# (base de datos local con la estructura de producción y sin datos, variables generadas, cuenta de prueba)",
  "# y corre Shannon contra esa copia de la app. Nunca contra producción.",
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
  "    services:",
  "      postgres:",
  "        image: postgres:16",
  "        env:",
  "          POSTGRES_PASSWORD: postgres",
  "          POSTGRES_DB: fixie_test",
  "        ports:",
  "          - 5432:5432",
  "        options: --health-cmd \"pg_isready -U postgres\" --health-interval 5s --health-timeout 5s --health-retries 20",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - uses: actions/setup-node@v4",
  "        with:",
  "          node-version: 22",
  "      - name: Detectar qué necesita la app",
  "        id: app",
  "        run: node .github/fixie/prepare.mjs detect",
  "      - name: Instalar dependencias",
  "        run: |",
  "          case \"${{ steps.app.outputs.pm }}\" in",
  "            pnpm) corepack enable && (pnpm install --frozen-lockfile || pnpm install) ;;",
  "            yarn) corepack enable && (yarn install --immutable || yarn install --frozen-lockfile || yarn install) ;;",
  "            bun) npm install -g bun && bun install ;;",
  "            *) npm ci || npm install ;;",
  "          esac",
  "      - name: Supabase CLI",
  "        if: steps.app.outputs.db == 'supabase'",
  "        uses: supabase/setup-cli@v1",
  "        with:",
  "          version: latest",
  "      - name: Supabase local (desechable)",
  "        if: steps.app.outputs.db == 'supabase'",
  "        run: |",
  "          [ -f supabase/config.toml ] || supabase init < /dev/null",
  "          supabase start",
  "          supabase status -o json > .fixie-supabase.json",
  "      - name: Variables de prueba",
  "        env:",
  "          FIXIE_TEST_ENV: ${{ secrets.FIXIE_TEST_ENV }}",
  "        run: node .github/fixie/prepare.mjs env",
  "      - name: Estructura de la base (sin datos)",
  "        if: steps.app.outputs.db != 'none'",
  "        env:",
  "          DB: ${{ steps.app.outputs.db_url }}",
  "          # Las migraciones con --accept-data-loss/--force van siempre contra la base desechable.",
  "          DATABASE_URL: ${{ steps.app.outputs.db_url }}",
  "          FIXIE_TEST_SCHEMA: ${{ secrets.FIXIE_TEST_SCHEMA }}",
  "        run: |",
  "          case \"${{ steps.app.outputs.migrate }}\" in",
  "            prisma) npx prisma migrate deploy || npx prisma db push --skip-generate --accept-data-loss || true ;;",
  "            drizzle) npx drizzle-kit push --force || true ;;",
  "          esac",
  "          if [ -n \"$FIXIE_TEST_SCHEMA\" ]; then",
  "            printf '%s' \"$FIXIE_TEST_SCHEMA\" | base64 -d | gunzip | psql \"$DB\" -q -v ON_ERROR_STOP=0 2>&1 | tail -30 || true",
  "          fi",
  "      - name: Cuenta de prueba y reglas del ataque",
  "        run: node .github/fixie/prepare.mjs account",
  "      - name: Compilar",
  "        run: |",
  "          node -e \"process.exit(require('./package.json').scripts?.build ? 0 : 1)\" || exit 0",
  "          case \"${{ steps.app.outputs.pm }}\" in",
  "            pnpm) pnpm run build ;;",
  "            yarn) yarn build ;;",
  "            bun) bun run build ;;",
  "            *) npm run build ;;",
  "          esac",
  "      - name: Levantar la app en el runner",
  "        run: |",
  "          if [ \"${{ steps.app.outputs.next }}\" = true ]; then",
  "            nohup npx next start -p 3000 -H 0.0.0.0 > app.log 2>&1 &",
  "          else",
  "            PORT=3000 HOST=0.0.0.0 nohup npm start > app.log 2>&1 &",
  "          fi",
  "          for i in $(seq 1 90); do curl -s -o /dev/null http://localhost:3000 && exit 0; sleep 2; done",
  "          echo \"La app no arrancó en el entorno de pruebas:\"; tail -200 app.log; exit 1",
  "      - name: Shannon",
  "        uses: KeygraphHQ/shannon-action@v1",
  "        with:",
  "          url: http://host.docker.internal:3000",
  "          config: ${{ github.workspace }}/fixie-shannon.yaml",
  "          api-key: ${{ secrets.SHANNON_AI_API_KEY }}",
  "          model: ${{ vars.FIXIE_SHANNON_MODEL }}",
  "          fail-on-severity: none",
  "      - name: Registro de la app",
  "        if: always()",
  "        uses: actions/upload-artifact@v4",
  "        with:",
  "          name: fixie-app-log",
  "          path: app.log",
  "          if-no-files-found: ignore",
  "",
].join("\n");

/** `workflow`: instalado y al día. `outdated`: instalado, pero de una versión anterior. */
export type DeepSetup = { workflow: boolean; outdated: boolean; secret: boolean; model: string | null };

export async function deepSetup(repo: Repo): Promise<DeepSetup> {
  const head = await repo.getDefaultBranchHead();
  const [file, secret, model] = await Promise.all([
    repo.readFile(PATH, head.sha).catch(() => null),
    repo.hasSecret(DEEP_SECRET).catch(() => false),
    repo.getVariable(DEEP_MODEL_VAR).catch(() => null),
  ]);
  const current = !!file && file.includes(WORKFLOW_VERSION);
  return { workflow: current, outdated: !!file && !current, secret, model };
}

/**
 * Shannon crea usuarios, envía formularios y modifica datos. Si las variables del
 * entorno de pruebas apuntan a la base o a la app de producción, el ataque las
 * tocaría. Devuelve el motivo para rechazarlas, o null si no apuntan a producción.
 */
export function pointsToProduction(testEnv: string, prod: { dbUrl: string | null; appUrl: string | null }): string | null {
  const values = testEnv
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*export\s+/, "").match(/^\s*([A-Za-z_][\w.]*)\s*=\s*(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ name: m[1], value: m[2].trim().replace(/^(['"])(.*)\1$/, "$2") }));

  const url = (v: string) => {
    try {
      return new URL(v);
    } catch {
      return null;
    }
  };
  const host = (h: string) => h.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const local = (h: string) => ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"].includes(h) || h.endsWith(".localhost");
  const db = prod.dbUrl ? url(prod.dbUrl) : null;
  const dbHost = db && !local(host(db.hostname)) ? host(db.hostname) : null;
  // El ref de Supabase aparece en el host directo (db.<ref>.supabase.co) o en el usuario del pooler (postgres.<ref>).
  const ref = db ? (db.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/)?.[1] ?? decodeURIComponent(db.username).match(/^[^.]+\.([a-z0-9]{20})$/)?.[1] ?? null) : null;
  const app = prod.appUrl ? url(prod.appUrl) : null;
  const appHost = app && !local(host(app.hostname)) ? host(app.hostname).replace(/^www\./, "") : null;

  // El mismo servidor de base, aunque cambie el usuario, la base o el puerto (y Neon con o sin "-pooler").
  const noPooler = (h: string) => h.replace(/^([^.]+)-pooler\./, "$1.");
  const sameDb = (h: string) => !!dbHost && noPooler(h) === noPooler(dbHost);
  // La app de producción con o sin www, y sus subdominios (api., auth.…).
  const sameApp = (h: string) => !!appHost && (h.replace(/^www\./, "") === appHost || h.endsWith(`.${appHost}`));
  // Las URLs del valor (aunque tengan un comentario o vayan dentro de otro texto) o un host suelto.
  const targets = (v: string) => {
    const out: { host: string; scheme: string }[] = [];
    for (const m of v.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi)) {
      const u = url(m[0]);
      if (u?.hostname) out.push({ host: host(u.hostname), scheme: u.protocol.slice(0, -1).toLowerCase() });
    }
    const bare = v.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?\/?$/i)?.[1];
    if (bare) out.push({ host: host(bare), scheme: "" });
    return out;
  };
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dbHostIn = dbHost ? new RegExp(`(^|[^a-z0-9-])${escape(dbHost)}($|[^a-z0-9-])`, "i") : null;

  for (const { name, value } of values) {
    if (ref && value.toLowerCase().includes(ref)) return `${name} apunta al proyecto de Supabase de producción.`;
    // PGHOST=…, "host=… port=…" o la URL con un comentario detrás: el host de producción en cualquier forma.
    if (dbHostIn?.test(value)) return `${name} es la base de datos de producción.`;
    for (const t of targets(value)) {
      if (local(t.host)) continue;
      if (sameDb(t.host)) return `${name} es la base de datos de producción.`;
      if (sameApp(t.host)) return `${name} apunta a tu app en producción (${app!.hostname}). Usa http://localhost:3000.`;
      // El runner ya trae su base desechable (y Supabase local). Una base remota podría ser
      // la de producción aunque Fixie no la conozca, y el workflow le aplica migraciones con
      // --accept-data-loss: se rechaza siempre.
      if (DATA_SCHEMES.has(t.scheme) || /(^|\.)supabase\.(co|com|in)$/.test(t.host)) {
        return `${name} apunta a una base de datos externa (${t.host}). El entorno de pruebas ya trae su propia base desechable, y Fixie no puede comprobar que esa no sea la de producción.`;
      }
    }
  }
  return null;
}

const DATA_SCHEMES = new Set(["postgres", "postgresql", "mysql", "mariadb", "mongodb", "mongodb+srv", "redis", "rediss"]);

/** Cifra el valor con la llave pública del repo (sealed box) y lo guarda como secreto de Actions. Fixie no lo guarda. */
export async function setRepoSecret(repo: Repo, name: string, value: string): Promise<void> {
  await sodium.ready;
  const { key, key_id } = await repo.getActionsPublicKey();
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(key, sodium.base64_variants.ORIGINAL));
  await repo.putSecret(name, sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id);
}

/** Instala el workflow con un PR que se mergea en el acto (el usuario lo pidió con el botón). */
export async function installDeepWorkflow(repo: Repo, update = false): Promise<void> {
  const head = await repo.getDefaultBranchHead();
  const title = update ? "Fixie: actualizar el pentest profundo" : "Fixie: activar el pentest profundo";
  const branch = `autosana/pentest-profundo-${Date.now().toString(36)}`;
  const sha = await repo.createCommit(head.sha, title, [
    { path: PATH, content: WORKFLOW_YAML },
    { path: PREPARE_PATH, content: PREPARE_SCRIPT },
  ]);
  await repo.createBranch(branch, sha);
  const pr = await repo.createPullRequest({
    head: branch,
    base: head.branch,
    title,
    body: [
      update
        ? "Actualiza el pentest profundo con **Shannon** (KeygraphHQ/shannon). Ahora Fixie arma solo el entorno de pruebas."
        : "Agrega el pentest profundo con **Shannon** (KeygraphHQ/shannon). Corre en este repo cuando Fixie lo pide.",
      "",
      "Cada corrida, dentro de un runner desechable de GitHub Actions:",
      "",
      "- `.github/fixie/prepare.mjs` detecta qué usa la app (Postgres, Supabase, Prisma, Drizzle) y qué variables lee.",
      "- Levanta una base de datos local con la estructura de producción y **sin ningún dato**. Genera secretos aleatorios y URLs locales; borra los `.env` del repo dentro del runner por si traen valores de producción.",
      "- Con Supabase crea una cuenta de prueba para que Shannon también pruebe lo que pide login.",
      "- Shannon lee el código y ataca esa copia. **Nunca toca producción.**",
      "- Solo reporta lo que logró explotar. Fixie lee el reporte y repara cada hallazgo con su PR.",
      "",
      "El modelo sale de la variable `FIXIE_SHANNON_MODEL` y la clave del secreto `SHANNON_AI_API_KEY`.",
    ].join("\n"),
  });
  await repo.mergePullRequest(pr.number, title);
}

/** El secreto de Actions admite hasta 48 KB. */
const SCHEMA_SECRET = "FIXIE_TEST_SCHEMA";
const SCHEMA_MAX = 47_000;

/**
 * Copia la estructura de la base de producción (sin filas) al secreto que el
 * workflow aplica en la base desechable. Solo lee producción. Devuelve false si
 * no hay base conectada o si la estructura no cabe en un secreto.
 */
export async function syncTestSchema(repo: Repo, dbUrl: string | null): Promise<boolean> {
  if (!dbUrl) return false;
  const ddl = await schemaDDL(dbUrl);
  const packed = Buffer.from(gzipSync(strToU8(ddl), { level: 9 })).toString("base64");
  if (packed.length > SCHEMA_MAX) return false;
  await setRepoSecret(repo, SCHEMA_SECRET, packed);
  return true;
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
  const seen = new Map<string, number>();
  // El target puede venir relativo ("/api/users"): new URL() sin base lanzaría y tiraría todo el reporte.
  const pathOf = (target: string) => {
    try {
      return new URL(target, "http://app.local").pathname;
    } catch {
      return target.slice(0, 200);
    }
  };
  for (const [i, r] of (sarif.runs?.[0]?.results ?? []).entries()) {
    const status = r.properties?.status;
    if (status && status !== "exploited") continue;
    const md = r.message?.markdown ?? r.message?.text ?? "";
    const title = (md.match(/^\*\*(.+?)\*\*/)?.[1] ?? r.message?.text?.split(". ")[0] ?? r.ruleId ?? "Vulnerabilidad").slice(0, 160);
    const loc = r.locations?.[0]?.physicalLocation;
    const where = loc?.artifactLocation?.uri ? `${loc.artifactLocation.uri}${loc.region?.startLine ? `:${loc.region.startLine}` : ""}` : null;
    const unauth = /^unauth/i.test(r.properties?.authState ?? "");
    // En SARIF, un resultado sin `level` vale "warning".
    const level = r.level ?? "warning";
    const severity: Severity = level === "error" ? (unauth ? "critico" : "alto") : level === "warning" ? "medio" : "bajo";
    const impact = section(md, "Impact");
    // Ids únicos aunque falten findingId, ruleId o ubicación.
    let id = `shannon:${r.properties?.findingId ?? `${r.ruleId ?? "regla"}:${where ?? i}`}`;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n) id += `:${n + 1}`;
    out.push({
      id,
      title,
      severity,
      passed: false,
      detail: [
        "Explotada por Shannon en el entorno de pruebas.",
        r.webRequest?.method && r.webRequest.target ? `${r.webRequest.method} ${pathOf(r.webRequest.target)}.` : null,
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

  let findings: Finding[] | null = null;
  let unreadable = false;
  const artifacts = (await repo.listRunArtifacts(run.id)).filter((x) => !x.expired);
  // Solo el reporte: el artefacto con los registros de Shannon puede pesar mucho.
  for (const a of artifacts.filter((x) => x.name.startsWith("shannon-report") && x.size_in_bytes < 60_000_000)) {
    // Un fallo de red al descargar se propaga: la próxima revisión lo reintenta.
    const zip = await repo.downloadArtifact(a.id);
    // Un reporte corrupto, en cambio, nunca se va a poder leer: se cierra como fallido
    // en vez de dejar el análisis "en curso" para siempre.
    try {
      const files = unzipSync(zip, { filter: (f) => f.name.endsWith(".sarif") });
      const name = Object.keys(files)[0];
      if (name) {
        findings = sarifFindings(JSON.parse(strFromU8(files[name])) as Sarif);
        break;
      }
    } catch {
      unreadable = true;
    }
  }
  if (!findings) {
    const shannonRan = artifacts.some((x) => x.name.startsWith("shannon-"));
    return {
      state: "failed",
      url: run.html_url,
      summary: unreadable
        ? "No se pudo leer el reporte de Shannon. Revisa la ejecución en GitHub Actions."
        : run.conclusion === "cancelled"
          ? "La ejecución se canceló en GitHub Actions antes de terminar."
          : shannonRan
            ? run.conclusion === "success"
              ? "Shannon terminó sin reporte SARIF."
              : "Shannon no terminó el ataque. Revisa la ejecución en GitHub Actions."
            : "La copia de tu app no arrancó en el entorno de pruebas, así que Shannon no pudo atacarla. El registro está en la ejecución de GitHub Actions.",
    };
  }
  const exploited = findings.length;
  findings.push({
    id: "shannon-run",
    title: "Pentest profundo completo",
    severity: "info",
    passed: exploited === 0,
    detail: exploited ? `Shannon explotó ${exploited} ${exploited === 1 ? "vulnerabilidad" : "vulnerabilidades"}.` : "Shannon no logró explotar nada.",
  });
  return {
    state: "done",
    url: run.html_url,
    result: { status: "ok", score: scoreOf(findings), summary: findings.length > 1 ? summaryOf(findings) : "Sin vulnerabilidades explotables.", findings, meta: { run: run.html_url } },
  };
}
