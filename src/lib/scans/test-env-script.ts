/**
 * Script que Fixie instala en `.github/fixie/prepare.mjs` del repo del cliente.
 * Corre dentro del runner de GitHub Actions y arma el entorno de pruebas del
 * pentest profundo sin que el usuario configure nada:
 *
 * - `detect`: lee el repo y decide qué base necesita la app (ninguna, Postgres o
 *   Supabase), con qué se migra y qué gestor de paquetes usa.
 * - `env`: borra los .env del repo (podrían traer valores de producción) y
 *   escribe unos nuevos con la base desechable, secretos aleatorios y URLs
 *   locales.
 * - `account`: después de copiar la estructura (con sus triggers), crea con
 *   Supabase un usuario de prueba y escribe la configuración de Shannon con las
 *   reglas del ataque.
 *
 * Va como texto (String.raw): sin comillas invertidas ni interpolaciones dentro.
 */
export const PREPARE_SCRIPT = String.raw`// Lo instala Fixie. Arma el entorno de pruebas del pentest profundo dentro de este runner.
// Nada de esto toca producción: la base es local y desechable, y los secretos son aleatorios.
import { appendFileSync, existsSync, lstatSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { randomBytes } from "node:crypto";

const root = process.cwd();
const phase = process.argv[2];
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
const exists = (p) => existsSync(join(root, p));
const output = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, k + "=" + v + "\n"); console.log(k + "=" + v); };
const pkg = (() => { try { return JSON.parse(read("package.json") || "{}"); } catch { return {}; } })();
const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".vercel", ".turbo", "coverage", ".svelte-kit", ".nuxt", ".output"]);
const CODE = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".astro"]);
// Archivos .env del repo en cualquier carpeta (prisma/.env, apps/web/.env…), salvo los de ejemplo.
const ENV_FILE = /^\.env(\..+)?$/;
const ENV_EXAMPLE = /(example|sample|template|dist|defaults)/;
const envFiles = [];
function walk(dir, files) {
  let entries;
  try { entries = readdirSync(dir); } catch { return files; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || files.length > 8000) continue;
    const p = join(dir, name);
    let s;
    // lstat: los enlaces simbólicos no se siguen (un enlace a una carpeta padre no termina nunca).
    try { s = lstatSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, files);
    else if (!s.isFile()) continue;
    else if (ENV_FILE.test(name) && !ENV_EXAMPLE.test(name)) envFiles.push(p);
    else if (CODE.has(extname(name)) && s.size < 600000) files.push(p);
  }
  return files;
}
const files = walk(root, []);

// Variables que la app lee: las de los .env de ejemplo y las del código.
const names = new Set();
for (const f of [".env.example", ".env.sample", ".env.local.example", ".env.template", ".env.dist", "example.env", ".env.defaults"]) {
  for (const line of read(f).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) names.add(m[1]);
  }
}
const ENV_RE = /(?:process\.env|import\.meta\.env)(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\])/g;
for (const f of files) {
  let text = "";
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  for (const m of text.matchAll(ENV_RE)) names.add(m[1] || m[2]);
}
const prismaSchema = ["prisma/schema.prisma", "schema.prisma", "prisma/schema/schema.prisma"].find(exists);
if (prismaSchema) for (const m of read(prismaSchema).matchAll(/env\(\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\)/g)) names.add(m[1]);
const IGNORE = /^(NODE_ENV|CI|PORT|HOST|HOSTNAME|HOME|PATH|PWD|TZ|LANG|SHELL|USER|TMPDIR|NEXT_RUNTIME|NEXT_PHASE|NEXT_TELEMETRY_DISABLED|ANALYZE|DEBUG|VERCEL|VERCEL_[A-Z0-9_]*|NETLIFY|GITHUB_[A-Z0-9_]*|RUNNER_[A-Z0-9_]*|npm_[A-Za-z0-9_]*|MODE|DEV|PROD|SSR|BASE_URL)$/;
const envNames = [...names].filter((n) => !IGNORE.test(n)).sort();

// Qué base usa la app.
const prismaPg = !!prismaSchema && /provider\s*=\s*"(postgres|postgresql)"/.test(read(prismaSchema));
const drizzleConfig = ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs", "drizzle.config.json"].find(exists);
const supabase = has("@supabase/supabase-js") || has("@supabase/ssr") || has("@supabase/auth-helpers-nextjs") || exists("supabase/config.toml") || envNames.some((n) => /SUPABASE/.test(n));
const postgres = prismaPg || has("pg") || has("postgres") || has("@vercel/postgres") || has("@neondatabase/serverless") || has("kysely") || envNames.some((n) => /^(DATABASE|POSTGRES|PG)_?(URL|URI)/.test(n));
const db = supabase ? "supabase" : postgres ? "postgres" : "none";
const sbMigrations = (() => { try { return readdirSync(join(root, "supabase/migrations")).some((f) => f.endsWith(".sql")); } catch { return false; } })();
const migrate = prismaPg ? "prisma" : drizzleConfig && has("drizzle-kit") ? "drizzle" : db === "supabase" && sbMigrations ? "supabase" : "none";
const dbUrl = db === "supabase" ? "postgresql://postgres:postgres@127.0.0.1:54322/postgres" : "postgresql://postgres:postgres@localhost:5432/fixie_test";
const pm = exists("pnpm-lock.yaml") ? "pnpm" : exists("yarn.lock") ? "yarn" : exists("bun.lockb") || exists("bun.lock") ? "bun" : "npm";

if (phase === "detect") {
  output("db", db);
  output("migrate", migrate);
  output("db_url", dbUrl);
  output("pm", pm);
  output("next", has("next") ? "true" : "false");
  console.log("Variables que usa la app: " + (envNames.join(", ") || "ninguna"));
  process.exit(0);
}

if (phase !== "env" && phase !== "account") {
  console.error("Uso: node prepare.mjs detect|env|account");
  process.exit(1);
}

// Supabase local: llaves que imprime "supabase status -o json".
const sb = (() => { try { return JSON.parse(read(".fixie-supabase.json")); } catch { return {}; } })();
const sbUrl = sb.API_URL || "http://127.0.0.1:54321";
const sbAnon = sb.ANON_KEY || sb.PUBLISHABLE_KEY || "";
const sbService = sb.SERVICE_ROLE_KEY || sb.SECRET_KEY || "";

// La base desechable por partes, para apps que usan PGHOST, DB_PASSWORD, POSTGRES_DB…
const dbParts = new URL(dbUrl);
const DB_PART = {
  HOST: dbParts.hostname, PORT: dbParts.port || "5432",
  USER: decodeURIComponent(dbParts.username), USERNAME: decodeURIComponent(dbParts.username),
  PASSWORD: decodeURIComponent(dbParts.password), PASS: decodeURIComponent(dbParts.password),
  DATABASE: dbParts.pathname.slice(1), DB: dbParts.pathname.slice(1), NAME: dbParts.pathname.slice(1),
};

const wanted = new Set(envNames);
if (db === "postgres") wanted.add("DATABASE_URL");
if (db === "supabase") { wanted.add("NEXT_PUBLIC_SUPABASE_URL"); wanted.add("NEXT_PUBLIC_SUPABASE_ANON_KEY"); }

function value(n) {
  const N = n.toUpperCase();
  if (/SUPABASE/.test(N) && /(URL|URI)$/.test(N)) return sbUrl;
  if (/SUPABASE/.test(N) && /(ANON|PUBLISHABLE)/.test(N)) return sbAnon;
  if (/SERVICE_ROLE/.test(N) || (/SUPABASE/.test(N) && /(SERVICE|SECRET)/.test(N))) return sbService;
  if (/(DATABASE|POSTGRES|PG|DB)_?(URL|URI|PRISMA_URL|URL_NON_POOLING|URL_UNPOOLED|URL_NO_SSL)$/.test(N) || N === "DIRECT_URL" || N === "SHADOW_DATABASE_URL") return dbUrl;
  const part = N.match(/^(?:PG|POSTGRES_?|DB_|DATABASE_)(HOST|PORT|USER|USERNAME|PASSWORD|PASS|DATABASE|DB|NAME)$/);
  if (part) return DB_PART[part[1]];
  if (/(URL|URI|ORIGIN|ENDPOINT)$/.test(N)) return /(SITE|APP|BASE|AUTH|PUBLIC|ORIGIN|CALLBACK|REDIRECT|DOMAIN|HOST|FRONTEND|CLIENT)/.test(N) ? "http://localhost:3000" : "http://localhost:9";
  if (/(SECRET|TOKEN|KEY|SALT|PASSWORD|PASS|PEPPER|SIGNING|PRIVATE|CREDENTIALS)/.test(N)) return "fixie_test_" + randomBytes(24).toString("hex");
  if (/(^ENABLE_|^DISABLE_|^USE_|_ENABLED$|_DISABLED$|^IS_|^FEATURE_)/.test(N)) return "false";
  if (/(^|_)(PORT|TIMEOUT|LIMIT|MAX|MIN|TTL|COUNT|SIZE|RETRIES|DAYS|HOURS|MINUTES|SECONDS)(_|$)/.test(N)) return "60";
  if (/EMAIL$/.test(N)) return "pentest@fixie.test";
  return "fixie-test";
}

if (phase === "env") {
  const env = {};
  for (const n of wanted) env[n] = value(n);
  // Claves de prueba que el usuario agregó a mano (opcional): ganan.
  for (const line of (process.env.FIXIE_TEST_ENV || "").split(/\r?\n/)) {
    const m = line.replace(/^\s*export\s+/, "").match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }

  // Los .env del repo podrían traer valores de producción: fuera todos (también los de
  // subcarpetas como prisma/.env), salvo los de ejemplo.
  for (const f of envFiles) {
    try { unlinkSync(f); console.log("Quitado " + f.slice(root.length + 1) + " (podía traer valores de producción)"); } catch {}
  }
  const quote = (v) => JSON.stringify(String(v));
  const body = Object.keys(env).sort().map((k) => k + "=" + quote(env[k])).join("\n") + "\n";
  writeFileSync(join(root, ".env"), body);
  writeFileSync(join(root, ".env.local"), body);
  writeFileSync(join(root, ".env.production.local"), body);
  console.log("Entorno de pruebas listo con " + Object.keys(env).length + " variables: " + Object.keys(env).sort().join(", "));
  process.exit(0);
}

// Fase "account": la estructura de la base ya está aplicada (con sus triggers de auth).

// Usuario de prueba: con Supabase Auth se crea directo en la base desechable.
let account = null;
if (db === "supabase" && sbService) {
  const email = "pentest@fixie.test";
  const password = "Fx-" + randomBytes(12).toString("base64url");
  const res = await fetch(sbUrl + "/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: sbService, authorization: "Bearer " + sbService, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  }).catch(() => null);
  if (res && res.ok) { account = { email, password }; console.log("Usuario de prueba creado: " + email); }
  else console.log("No se pudo crear el usuario de prueba (" + (res ? res.status : "sin respuesta") + ").");
}

// Página de login, para decirle a Shannon dónde entrar.
const LOGIN_RE = /(?:^|[\\/])(?:app|pages|routes|src[\\/]app|src[\\/]pages|src[\\/]routes)[\\/](.*?)(login|signin|sign-in|log-in|iniciar-sesion|ingresar|entrar|acceder)(?:[\\/](?:page|index|\+page)\.[a-z]+|\.[a-z]+)$/i;
let loginPath = null;
for (const f of files) {
  const m = f.slice(root.length).match(LOGIN_RE);
  if (m) {
    loginPath = "/" + (m[1] + m[2]).split(/[\\/]/).filter((s) => s && !/^\(.*\)$/.test(s)).join("/");
    break;
  }
}
console.log("Página de login: " + (loginPath || "no encontrada"));

const target = "http://host.docker.internal:3000";
const rules = [
  "- The target is a disposable copy of the app started inside this CI runner for this test only: " + target + "." + (db === "none" ? "" : " Its database is a throwaway local database with the production schema and no real data.") + " Do not test any other host.",
  "- Third-party services (payments, email, AI APIs) have fake placeholder keys. Do not report failures that only come from those placeholders.",
  account
    ? "- A test account already exists: email " + account.email + ", password " + account.password + (loginPath ? ". Log in at " + target + loginPath : "") + ". Use it for authenticated testing."
    : "- If the app has a sign-up page, create your own test accounts for authenticated testing.",
];
const config = {
  description: "Web app" + (has("next") ? " built with Next.js" : "") + (db === "supabase" ? " on Supabase" : db === "postgres" ? " on PostgreSQL" : "") + ". Tested by Fixie in an isolated CI environment.",
  rules_of_engagement: rules.join("\n"),
};
// JSON es YAML válido.
writeFileSync(join(root, "fixie-shannon.yaml"), JSON.stringify(config, null, 2) + "\n");
`;
