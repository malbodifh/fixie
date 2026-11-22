import "server-only";
import { postStep, type RepairInfo } from "../incidents";
import type { ProjectContext } from "../projects";

/**
 * Cambios de texto que el usuario eligió en Conversión. Sin IA: busca el texto
 * literal en el código y lo reemplaza. Si algún texto no aparece tal cual (por
 * ejemplo, viene de una base de datos o está partido en JSX), devuelve false y
 * la reparación pasa al agente.
 */

const SOURCE = /^(src\/|app\/|components\/|content\/|messages\/|locales\/|lib\/).*\.(tsx|jsx|ts|js|mdx|md|json)$/;
const MAX_FILES = 200;

/** Formas en que el mismo texto puede estar escrito en el código fuente. */
function variants(text: string): string[] {
  return [...new Set([text, text.replace(/'/g, "&apos;"), text.replace(/'/g, "&#39;"), text.replace(/"/g, "&quot;"), text.replace(/'/g, "\\'"), text.replace(/"/g, '\\"')])];
}

function reproTest(changes: { path: string; from: string; to: string }[]): string {
  return `import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Fixie: los textos que elegiste en Conversión.
const cambios = ${JSON.stringify(changes, null, 2)};

describe("textos de conversión", () => {
  for (const c of cambios) {
    it(\`\${c.path}: "\${c.to.slice(0, 40)}"\`, () => {
      const src = readFileSync(c.path, "utf8");
      expect(src).toContain(c.to);
      expect(src).not.toContain(c.from);
    });
  }
});
`;
}

export async function applyCopyAndOpenPR(ctx: ProjectContext, issueNumber: number, info: RepairInfo): Promise<boolean> {
  const { repo, project } = ctx;
  const copies = info.findings.filter((f) => f.copy);
  if (copies.length === 0 || copies.length !== info.findings.length) return false;

  await postStep(repo, issueNumber, "diagnosing", "Buscando cada texto en el código…");
  const head = await repo.getDefaultBranchHead();
  const paths = (await repo.listFiles(head.sha)).filter((p) => SOURCE.test(p) && !/(^|\/)(tests?|__tests__)\//.test(p)).slice(0, MAX_FILES);
  const files = new Map<string, string>();
  await Promise.all(paths.map(async (p) => files.set(p, await repo.readFile(p, head.sha).catch(() => ""))));

  const changed = new Map<string, string>();
  const test: { path: string; from: string; to: string }[] = [];
  for (const f of copies) {
    const { from, to } = f.copy!;
    let found = false;
    for (const [path, original] of files) {
      const current = changed.get(path) ?? original;
      const hit = variants(from).find((v) => current.includes(v));
      if (!hit) continue;
      // Se escribe con la misma forma de escapar que ya usa el archivo.
      const replacement = hit === from ? to : variants(to)[variants(from).indexOf(hit)] ?? to;
      changed.set(path, current.split(hit).join(replacement));
      test.push({ path, from: hit, to: replacement });
      found = true;
    }
    if (!found) return false;
  }

  await postStep(repo, issueNumber, "diagnosis", `**Textos:** ${copies.map((f) => `"${f.copy!.from}" → "${f.copy!.to}"`).join(" · ")}. Encontrados en ${[...new Set(test.map((t) => `\`${t.path}\``))].join(", ")}.`);

  const testPath = `tests/fixie-textos-${issueNumber}.test.ts`;
  const testSha = await repo.createCommit(head.sha, `test: textos de conversión elegidos (#${issueNumber})`, [{ path: testPath, content: reproTest(test) }]);
  const fixSha = await repo.createCommit(
    testSha,
    `copy: ${copies.length} textos para convertir más\n\nCambios elegidos en Fixie para #${issueNumber}.`,
    [...changed].map(([path, content]) => ({ path, content })),
  );
  const branch = `autosana/textos-${issueNumber}-${Date.now().toString(36)}`;
  await repo.createBranch(branch, testSha);
  const pr = await repo.createPullRequest({
    head: branch,
    base: head.branch,
    title: `copy: ${copies.length} textos para convertir más`,
    body: `Textos que elegiste en **Fixie** (#${issueNumber}).

| Antes | Después | Por qué |
|---|---|---|
${copies.map((f) => `| ${f.copy!.from} | ${f.copy!.to} | ${f.detail} |`).join("\n")}

### Entorno de pruebas
1. Commit 1: una prueba que exige los textos nuevos. CI debe **fallar**.
2. Commit 2: los textos cambiados. CI debe pasar, con todas tus pruebas.
3. Otro agente revisa que el cambio no rompa la página.

${project.auto_merge ? "Se mergea automáticamente cuando el revisor la aprueba." : "Requiere revisión humana antes de mergear."}

Closes #${issueNumber}`,
  });
  await postStep(repo, issueNumber, "pr_opened", `PR #${pr.number} abierto en el entorno de pruebas. Primero corre la prueba con los textos actuales…`, { pr: pr.number, sha: testSha, fixSha, round: 1 });
  return true;
}
