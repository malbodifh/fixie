import "server-only";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { postStep, type RepairInfo } from "../incidents";
import { REPAIR_LABEL } from "../model";
import type { ProjectContext } from "../projects";
import { isCriticalWork, metered } from "../usage";
import { agentModel } from "./model";
import { describeRepair, fileSchema, invalidPaths, readTools, REPAIR_RULES, REPAIR_WRITABLE, REVIEW_TESTS, TESTS, type FileOut } from "./tools";

const INSTRUCTIONS = `Eres Fixie. Un análisis de la app en producción encontró hallazgos y tu trabajo es repararlos todos.
Trabajas en un entorno de pruebas: primero REPRODUCES cada hallazgo con una prueba que falla, después lo arreglas.

Proceso:
1. Lee los archivos implicados con leer_archivo (next.config, layout, páginas, componentes, formularios).
2. Para cada hallazgo, decide el cambio mínimo que lo resuelve.
3. Llama a proponer_reparacion UNA vez con:
   - pruebas: pruebas vitest nuevas en tests/ que FALLAN con el código actual porque el hallazgo existe y
     pasan con la reparación. Ejemplos: importar next.config y exigir la cabecera en headers(); importar
     \`metadata\` del layout y exigir openGraph; renderizar el componente con react-dom/server y exigir
     <label> en sus campos; leer el archivo de la página y exigir que no enlace a rutas inexistentes.
   - arreglo: el contenido COMPLETO de cada archivo cambiado (no diffs). No pongas pruebas aquí.
   - omitidos: los hallazgos que no puedes reparar con seguridad, con la razón.

${REPAIR_RULES}`;

function prBody(issue: number, info: RepairInfo, resumen: string, omitidos: string[], autoMerge: boolean): string {
  return `Reparación automática de **Fixie** para ${info.findings.length} hallazgos de ${REPAIR_LABEL[info.kind]} (#${issue}).

### Hallazgos
${info.findings.map((f) => `- **${f.title}** (${f.severity})`).join("\n")}

### Reparación
${resumen}
${omitidos.length ? `\n### Requieren acción humana\n${omitidos.map((o) => `- ${o}`).join("\n")}\n` : ""}
### Entorno de pruebas
1. Commit 1: solo las pruebas. CI debe **fallar** (reproduce los hallazgos).
2. Commit 2: la reparación. CI debe pasar.
3. Otro agente intenta demostrar que la reparación está incompleta o rompe la app. Si lo logra, se repara otra vez.
4. Tras el merge, Fixie vuelve a analizar producción para confirmar que los hallazgos desaparecieron.

${autoMerge ? "Se mergea automáticamente cuando el revisor la aprueba." : "Requiere revisión humana antes de mergear."}

Closes #${issue}`;
}

/** Repara los hallazgos de un análisis: pruebas que los reproducen, arreglo y PR del entorno de pruebas. */
export async function repairAndOpenPR(ctx: ProjectContext, issueNumber: number, info: RepairInfo): Promise<void> {
  const { repo, project } = ctx;
  await postStep(repo, issueNumber, "diagnosing", "Leyendo el código para reparar los hallazgos…");

  const head = await repo.getDefaultBranchHead();
  const { tools: read, files } = await readTools({ repo, ref: head.sha, issue: issueNumber, dbUrl: null });

  type Proposal = { titulo: string; resumen: string; pruebas: FileOut[]; arreglo: FileOut[]; omitidos: string[] };
  let proposal: Proposal | null = null;

  const tools = {
    ...read,
    proponer_reparacion: tool({
      description: "Entrega las pruebas que reproducen los hallazgos y la reparación. Llamar una sola vez.",
      inputSchema: z.object({
        titulo: z.string().max(80).describe("Título del PR, estilo commit: fix(seguridad): …"),
        resumen: z.string().max(1500).describe("Qué cambia la reparación, hallazgo por hallazgo"),
        pruebas: z.array(fileSchema).min(1).max(4).describe("Pruebas vitest nuevas en tests/ que fallan sin la reparación"),
        arreglo: z.array(fileSchema).min(1).max(8).describe("Archivos con su contenido COMPLETO"),
        omitidos: z.array(z.string().max(300)).max(10).describe("Hallazgos que no se pueden reparar con código, con la razón"),
      }),
      execute: async (input) => {
        const badTests = input.pruebas.filter((f) => !TESTS.test(f.path) || REVIEW_TESTS.test(f.path)).map((f) => f.path);
        if (badTests.length) return { aceptado: false, error: `Las pruebas van en tests/: ${badTests.join(", ")}` };
        const badFix = [...invalidPaths(input.arreglo, REPAIR_WRITABLE), ...input.arreglo.filter((f) => TESTS.test(f.path)).map((f) => f.path)];
        if (badFix.length) return { aceptado: false, error: `Rutas no permitidas en la reparación: ${badFix.join(", ")}` };
        proposal = input;
        return { aceptado: true };
      },
    }),
  };

  await metered({ project, kind: "repair", critical: isCriticalWork(info), incident: issueNumber, done: () => proposal !== null }, (m) =>
    generateText({
    model: agentModel(),
    instructions: INSTRUCTIONS,
    prompt: `${describeRepair(info, project.app_url)}

Archivos del repositorio:
${files.join("\n")}`,
    tools,
    stopWhen: [() => proposal !== null, isStepCount(20), m.stopWhen],
    onStepEnd: m.onStepEnd,
    maxOutputTokens: 20_000,
  }));

  const fix = proposal as Proposal | null;
  if (!fix) throw new Error("No encontré una reparación segura. Un humano debe revisar estos hallazgos.");

  await postStep(
    repo,
    issueNumber,
    "diagnosis",
    `**Reparación:** ${fix.resumen}${fix.omitidos.length ? `\n\n**Requieren acción tuya:** ${fix.omitidos.join(" · ")}` : ""}`,
  );

  const testSha = await repo.createCommit(head.sha, `test: reproduce los hallazgos de ${REPAIR_LABEL[info.kind]} (#${issueNumber})`, fix.pruebas.map((f) => ({ path: f.path, content: f.contenido })));
  const fixSha = await repo.createCommit(
    testSha,
    `${fix.titulo}\n\nReparación automática de Fixie para #${issueNumber}.`,
    fix.arreglo.map((f) => ({ path: f.path, content: f.contenido })),
  );

  const branch = `autosana/reparacion-${info.kind}-${issueNumber}-${Date.now().toString(36)}`;
  await repo.createBranch(branch, testSha);
  const pr = await repo.createPullRequest({
    head: branch,
    base: head.branch,
    title: fix.titulo,
    body: prBody(issueNumber, info, fix.resumen, fix.omitidos, project.auto_merge),
  });

  await postStep(repo, issueNumber, "pr_opened", `PR #${pr.number} abierto en el entorno de pruebas. Primero corren las pruebas SIN la reparación para reproducir los hallazgos…`, {
    pr: pr.number,
    sha: testSha,
    fixSha,
    round: 1,
  });
}
