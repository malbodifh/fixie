import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postStep, type RepairInfo } from "../incidents";
import type { ProjectContext } from "../projects";
import { cmp, isVersion, sameLine, satisfies } from "../semver";

/**
 * Actualización de dependencias vulnerables, sin IA. La versión corregida sale
 * de la base de vulnerabilidades. Dos caminos:
 *  1. Parche directo del lockfile con los datos del registro de npm (tarball,
 *     integridad, dependencias), solo si el resto del árbol sigue siendo compatible.
 *  2. Si no, se regenera el lockfile con npm en una carpeta temporal, sin
 *     ejecutar scripts de los paquetes.
 * Un salto de versión mayor nunca se hace solo: queda para un humano.
 */

const REGISTRY = "https://registry.npmjs.org";
const NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;

type Manifest = {
  version: string;
  dist: { tarball: string; integrity?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
};
type LockEntry = {
  version?: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  name?: string;
  link?: boolean;
};
type Lock = { lockfileVersion?: number; packages?: Record<string, LockEntry> };
type PkgJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; overrides?: Record<string, unknown> };
type Target = { name: string; from: string; to: string; advisories: string[] };

async function manifest(name: string, version: string): Promise<Manifest> {
  if (!NAME.test(name) || !isVersion(version)) throw new Error(`Paquete inválido: ${name}@${version}`);
  const res = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}/${version}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`El registro de npm respondió ${res.status} para ${name}@${version}`);
  return (await res.json()) as Manifest;
}

const nameOf = (path: string) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);

/** La copia de `dep` que ve el paquete en `path` (la más cercana, como resuelve Node). */
function nearest(packages: Record<string, LockEntry>, path: string, dep: string): LockEntry | null {
  let base = path;
  for (;;) {
    const hit = packages[`${base}/node_modules/${dep}`];
    if (hit) return hit;
    const i = base.lastIndexOf("/node_modules/");
    if (i < 0) break;
    base = base.slice(0, i);
  }
  return packages[`node_modules/${dep}`] ?? null;
}

/**
 * Regenera el lockfile con npm en una carpeta temporal: solo resuelve versiones
 * del registro (--package-lock-only) y nunca ejecuta scripts de los paquetes.
 * Devuelve null si npm no está disponible o falla.
 */
async function regenerateLock(pkgText: string, lockText: string): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "fixie-deps-"));
  try {
    await writeFile(join(dir, "package.json"), pkgText);
    await writeFile(join(dir, "package-lock.json"), lockText);
    const args = ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"];
    // En Windows npm es un .cmd: se llama vía cmd.exe con argumentos fijos.
    const [cmd, argv] = process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", "npm", ...args]] : ["npm", args];
    await new Promise<void>((resolve, reject) =>
      execFile(cmd, argv, { cwd: dir, timeout: 180_000 }, (err) => (err ? reject(err) : resolve())),
    );
    return await readFile(join(dir, "package-lock.json"), "utf8");
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Rango nuevo para package.json, respetando el estilo (versión fija o ^/~). */
function bumpRange(range: string, to: string): string {
  if (isVersion(range)) return to;
  if (range.startsWith("~")) return `~${to}`;
  return `^${to}`;
}

/** Copias de `name` en el mismo carril que `to` y por debajo de esa versión. */
function vulnerableCopies(packages: Record<string, LockEntry>, name: string, to: string): string[] {
  return Object.keys(packages).filter((p) => {
    const v = packages[p].version ?? "";
    return p && !packages[p].link && nameOf(p) === name && sameLine(v, to) && cmp(v, to) < 0;
  });
}

function reproTest(targets: Target[]): string {
  const cases = targets
    .map((t) => `  it("${t.name}: ninguna copia por debajo de ${t.to}", () => {\n    expect(copies("${t.name}").filter((v) => below(v, "${t.to}"))).toEqual([]);\n  });`)
    .join("\n");
  return `// Fixie: reproduce las dependencias vulnerables. Falla mientras el árbol instalado
// (package-lock.json, el mismo que instala npm ci) tenga una versión afectada.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { packages: Record<string, { version?: string }> };
const copies = (name: string) =>
  Object.entries(lock.packages)
    .filter(([path]) => path === "node_modules/" + name || path.endsWith("/node_modules/" + name))
    .map(([, entry]) => entry.version ?? "0.0.0");

const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number);
const below = (version: string, min: string): boolean => {
  const a = parts(version);
  const b = parts(min);
  // Solo cuenta el mismo carril de versión que la corregida.
  if (a[0] !== b[0] || (a[0] === 0 && a[1] !== b[1])) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

describe("dependencias sin vulnerabilidades conocidas", () => {
${cases}
});
`;
}

export async function updateDepsAndOpenPR(ctx: ProjectContext, issueNumber: number, info: RepairInfo): Promise<void> {
  const { repo, project } = ctx;
  await postStep(repo, issueNumber, "diagnosing", "Calculando la versión segura de cada paquete en el registro de npm…");

  // Versión objetivo por paquete: la mayor de las corregidas (cubre todas sus vulnerabilidades).
  const targets = new Map<string, Target>();
  for (const f of info.findings) {
    if (!f.pkg) continue;
    const advisory = f.id.split(":").at(-1) ?? f.id;
    const t = targets.get(f.pkg.name);
    if (!t) targets.set(f.pkg.name, { name: f.pkg.name, from: f.pkg.from, to: f.pkg.to, advisories: [advisory] });
    else {
      if (cmp(f.pkg.to, t.to) > 0) t.to = f.pkg.to;
      t.advisories.push(advisory);
    }
  }
  if (targets.size === 0) throw new Error("No hay versiones corregidas a las que actualizar.");

  const head = await repo.getDefaultBranchHead();
  await postStep(repo, issueNumber, "reading", "Leyendo `package.json` y `package-lock.json`", { path: "package-lock.json" });
  const pkgText = await repo.readFile("package.json", head.sha);
  const lockText = await repo.readFile("package-lock.json", head.sha);
  const pkg = JSON.parse(pkgText) as PkgJson;
  const lock = JSON.parse(lockText) as Lock;
  if (!lock.packages) throw new Error("El lockfile es v1: Fixie necesita lockfileVersion 2 o 3.");
  const packages = lock.packages;

  const done: Target[] = [];
  const skipped: string[] = [];
  const regen: Target[] = [];

  for (const t of targets.values()) {
    const all = Object.keys(packages).filter((p) => p && nameOf(p) === t.name && cmp(packages[p].version ?? "", t.to) < 0);
    if (all.length === 0) continue;
    const paths = vulnerableCopies(packages, t.name, t.to);
    if (paths.length < all.length) skipped.push(`${t.name}: pasar a ${t.to} es un salto de versión mayor en ${all.length - paths.length} copia(s)`);
    if (paths.length === 0) continue;

    let m: Manifest;
    try {
      m = await manifest(t.name, t.to);
    } catch (err) {
      skipped.push(`${t.name}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    // Camino 1: parche directo si cada dependencia de la versión nueva ya está en el árbol y es compatible.
    const compatible = paths.every((path) =>
      Object.entries(m.dependencies ?? {}).every(([dep, range]) => {
        const copy = nearest(packages, path, dep);
        return !!copy?.version && satisfies(copy.version, range);
      }),
    );
    if (compatible) {
      for (const path of paths) {
        const entry = packages[path];
        packages[path] = {
          ...entry,
          version: m.version,
          resolved: m.dist.tarball,
          integrity: m.dist.integrity ?? entry.integrity,
          dependencies: m.dependencies,
          optionalDependencies: m.optionalDependencies,
          peerDependencies: m.peerDependencies,
          engines: m.engines ?? entry.engines,
        };
      }
    } else {
      regen.push(t);
    }

    // Dependencia directa: el rango de package.json también debe aceptar la versión nueva.
    let direct = false;
    for (const field of ["dependencies", "devDependencies"] as const) {
      const range = pkg[field]?.[t.name];
      if (!range) continue;
      direct = true;
      const next = satisfies(t.to, range) && !isVersion(range) ? range : bumpRange(range, t.to);
      pkg[field]![t.name] = next;
      const root = packages[""];
      if (root?.[field]?.[t.name]) root[field]![t.name] = next;
    }
    // Indirecta que necesita regenerar: un override obliga a npm a usar la versión corregida.
    if (!compatible && !direct) pkg.overrides = { ...(pkg.overrides ?? {}), [t.name]: `^${t.to}` };
    done.push(t);
  }

  if (done.length === 0) throw new Error(`No pude actualizar automáticamente. ${skipped.join(" · ")}`);

  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  let lockOut = json(lock);
  let how = "lockfile parcheado con los datos del registro de npm";
  if (regen.length) {
    // Se parte del lockfile original: npm resuelve el árbol completo de forma coherente.
    // Si un paquete no puede subir (otro lo fija a una versión exacta), se deja fuera,
    // se quita su override y se regenera otra vez con el resto.
    let regenerated: string | null = null;
    for (let attempt = 0; attempt < 2 && done.length; attempt++) {
      regenerated = await regenerateLock(json(pkg), lockText);
      if (!regenerated) break;
      const check = (JSON.parse(regenerated) as Lock).packages ?? {};
      const stuck = done.filter((t) => vulnerableCopies(check, t.name, t.to).length > 0);
      if (stuck.length === 0) break;
      for (const t of stuck) {
        skipped.push(`${t.name}: otro paquete lo fija a una versión vulnerable; hay que esperar a que ese paquete publique un arreglo`);
        done.splice(done.indexOf(t), 1);
        if (pkg.overrides) delete pkg.overrides[t.name];
        for (const field of ["dependencies", "devDependencies"] as const) {
          const original = (JSON.parse(pkgText) as PkgJson)[field]?.[t.name];
          if (original && pkg[field]) pkg[field]![t.name] = original;
        }
      }
      regenerated = null;
    }
    if (pkg.overrides && Object.keys(pkg.overrides).length === 0) delete pkg.overrides;
    if (!regenerated || done.length === 0) {
      throw new Error(
        `No pude actualizar de forma segura${regenerated === null && done.length ? " (npm no está disponible para regenerar el lockfile)" : ""}. ${skipped.join(" · ")}`,
      );
    }
    lockOut = regenerated;
    how = "lockfile regenerado con npm, sin ejecutar scripts de los paquetes";
  }

  await postStep(
    repo,
    issueNumber,
    "diagnosis",
    `**Actualización:** ${done.map((d) => `${d.name} ${d.from} → ${d.to} (${d.advisories.join(", ")})`).join(" · ")}. ${how[0].toUpperCase()}${how.slice(1)}.${
      skipped.length ? `\n\n**Requieren acción tuya:** ${skipped.join(" · ")}` : ""
    }`,
  );

  const testPath = `tests/fixie-dependencias-${issueNumber}.test.ts`;
  const testSha = await repo.createCommit(head.sha, `test: reproduce dependencias vulnerables (#${issueNumber})`, [{ path: testPath, content: reproTest(done) }]);
  const fixSha = await repo.createCommit(
    testSha,
    `fix(deps): ${done.map((d) => `${d.name} ${d.to}`).join(", ")}\n\nActualización de seguridad automática de Fixie para #${issueNumber}.`,
    [
      { path: "package.json", content: json(pkg) },
      { path: "package-lock.json", content: lockOut },
    ],
  );

  const branch = `autosana/dependencias-${issueNumber}-${Date.now().toString(36)}`;
  await repo.createBranch(branch, testSha);
  const pr = await repo.createPullRequest({
    head: branch,
    base: head.branch,
    title: `fix(deps): actualizar ${done.map((d) => d.name).join(", ")} por vulnerabilidades`,
    body: `Actualización de seguridad automática de **Fixie** (#${issueNumber}).

| Paquete | Antes | Después | Vulnerabilidades |
|---|---|---|---|
${done.map((d) => `| \`${d.name}\` | ${d.from} | ${d.to} | ${d.advisories.join(", ")} |`).join("\n")}

Cómo: ${how}.
${skipped.length ? `\n### Requieren acción humana\n${skipped.map((s) => `- ${s}`).join("\n")}\n` : ""}
### Entorno de pruebas
1. Commit 1: una prueba que exige las versiones corregidas en el lockfile. CI debe **fallar** (reproduce la vulnerabilidad).
2. Commit 2: \`package.json\` y \`package-lock.json\` actualizados. CI debe pasar, con todas tus pruebas.
3. Otro agente busca usos de estos paquetes que puedan romperse con la versión nueva.
4. Tras el merge, Fixie vuelve a revisar el lockfile de main.

${project.auto_merge ? "Se mergea automáticamente cuando el revisor la aprueba." : "Requiere revisión humana antes de mergear."}

Closes #${issueNumber}`,
  });

  await postStep(repo, issueNumber, "pr_opened", `PR #${pr.number} abierto en el entorno de pruebas. Primero corre la prueba con las versiones vulnerables para reproducir el problema…`, {
    pr: pr.number,
    sha: testSha,
    fixSha,
    round: 1,
  });
}
