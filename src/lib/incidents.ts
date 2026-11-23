import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Issue, Repo } from "./github";
import {
  currentAttempt,
  currentRound,
  DEPLOY_TIMEOUT_MS,
  deriveStage,
  REPAIR_LABEL,
  STEP_KINDS,
  type Incident,
  type IncidentPayload,
  type IncidentSummary,
  type RepairInfo,
  type RepairSummary,
  type Step,
  type StepData,
  type StepKind,
} from "./model";

/** Lo que manda la app monitoreada desde onRequestError. */
export const incidentPayloadSchema = z.object({
  name: z.string().max(200).default("Error"),
  message: z.string().max(2000),
  stack: z.string().max(20_000).nullable().default(null),
  digest: z.string().max(200).nullable().default(null),
  request: z.object({ path: z.string().max(2000), method: z.string().max(10) }),
  route: z.object({ path: z.string().max(500), type: z.string().max(20) }),
  commit: z.string().max(64).nullable().default(null),
});
export type { Incident, IncidentPayload, RepairInfo, Stage, Step, StepKind } from "./model";

/** JSON que no puede cerrar el comentario HTML que lo contiene. */
function safeJson(value: unknown): string {
  // "-->" solo aparece dentro de strings del JSON: se escribe como el escape JSON
  // de ">" (seis caracteres literales), que JSON.parse vuelve a convertir en "-->".
  return JSON.stringify(value).replace(/-->/g, "--\\u003e");
}

/** Texto de la app monitoreada en el issue: una @mención no debe notificar a nadie en GitHub. */
const noMentions = (text: string) => text.replace(/@/g, "@\u200b");

const MARKER = /^<!-- autosana:(\{.*?\}) -->\n?/;

function encodeStep(kind: StepKind, text: string, data: StepData = {}): string {
  return `<!-- autosana:${safeJson({ kind, ...data })} -->\n${text}`;
}

export async function postStep(repo: Repo, issue: number, kind: StepKind, text: string, data: StepData = {}) {
  await repo.addComment(issue, encodeStep(kind, text, data));
}

/**
 * El agente no pudo terminar. Se cierra el issue para que la próxima
 * ocurrencia del error abra un incidente nuevo y el agente lo reintente.
 */
export async function markAgentFailed(repo: Repo, issue: number, text: string) {
  await postStep(repo, issue, "failed", `${text}\n\nSi el error vuelve a ocurrir, Fixie lo reintenta.`);
  await repo.closeIssue(issue);
}

function parseStep(body: string, at: string): Step | null {
  const m = body.match(MARKER);
  if (!m) return null;
  try {
    const { kind, ...data } = JSON.parse(m[1]) as { kind: StepKind } & StepData;
    if (!STEP_KINDS.includes(kind)) return null;
    return { kind, data, at, text: body.slice(m[0].length).trim() };
  } catch {
    return null;
  }
}

// ── Cuerpo del issue ──────────────────────────────────────────

export function fingerprint(p: IncidentPayload): string {
  // Mismo error en la misma ruta = mismo incidente.
  return createHash("sha1").update(`${p.name}|${p.message}|${p.route.path}`).digest("hex").slice(0, 12);
}

function issueBody(p: IncidentPayload, fp: string): string {
  return `<!-- autosana-incident:${safeJson({ fp, payload: p })} -->
**${noMentions(p.name)}:** ${noMentions(p.message)}

| | |
|---|---|
| Ruta | \`${p.route.path}\` (${p.route.type}) |
| Petición | \`${p.request.method} ${p.request.path}\` |
| Commit | \`${p.commit ?? "desconocido"}\` |

\`\`\`
${(p.stack ?? "(sin stack)").slice(0, 6000)}
\`\`\``;
}

export function parseIssueBody(body: string | null): { fp: string; payload: IncidentPayload } | null {
  const m = body?.match(/^<!-- autosana-incident:(\{[\s\S]*?\}) -->/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// ── Registro ──────────────────────────────────────────────────

// Evita issues duplicados cuando llegan varias peticiones juntas a la misma instancia.
const inFlight = new Map<string, Promise<{ issue: Issue; isNew: boolean }>>();

export function recordIncident(repo: Repo, p: IncidentPayload): Promise<{ issue: Issue; isNew: boolean }> {
  const fp = fingerprint(p);
  const key = `${repo.fullName}:${fp}`;
  const existing = inFlight.get(key);
  if (existing) return existing.then((r) => ({ ...r, isNew: false }));

  const task = (async () => {
    const open = await repo.listIncidentIssues("open");
    const match = open.find((i) => parseIssueBody(i.body)?.fp === fp);
    if (match) {
      await postStep(repo, match.number, "recurred", "El error volvió a ocurrir.");
      return { issue: match, isNew: false };
    }
    // El merge cierra el issue ("Closes #N") antes de que el despliegue llegue a
    // producción: lo que todavía lanza la versión anterior no es un incidente nuevo
    // (abriría otro PR con el mismo arreglo).
    const since = new Date(Date.now() - 2 * DEPLOY_TIMEOUT_MS).toISOString();
    const closed = (await repo.listIncidentIssues("closed", { since })).filter((i) => i.state_reason === "completed" && parseIssueBody(i.body)?.fp === fp);
    for (const candidate of closed) {
      const inc = await getIncident(repo, candidate.number).catch(() => null);
      if (inc?.stage !== "desplegando") continue;
      await postStep(repo, candidate.number, "recurred", "El error volvió a ocurrir mientras se despliega el arreglo.");
      return { issue: candidate, isNew: false };
    }
    const title = `${p.name}: ${p.message}`.slice(0, 200);
    const issue = await repo.createIssue(title, issueBody(p, fp));
    await postStep(repo, issue.number, "detected", `Error detectado en \`${p.route.path}\`.`);
    return { issue, isNew: true };
  })();

  inFlight.set(key, task);
  // Si falla, se olvida de inmediato (el siguiente reporte lo reintenta); con ambos
  // manejadores, el rechazo no queda como promesa sin atender.
  task.then(
    () => setTimeout(() => inFlight.delete(key), 30_000),
    () => inFlight.delete(key),
  );
  return task;
}

// ── Lectura ───────────────────────────────────────────────────

function buildIncident(issue: Issue, steps: Step[]): Incident {
  const attempt = currentAttempt(steps);
  const prStep = [...attempt].reverse().find((s) => s.data.pr);
  const mergeStep = attempt.find((s) => s.kind === "merged");
  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    createdAt: issue.created_at,
    payload: parseIssueBody(issue.body)?.payload ?? null,
    repair: parseRepairBody(issue.body),
    steps,
    stage: deriveStage(steps),
    round: currentRound(steps),
    occurrences: 1 + steps.filter((s) => s.kind === "recurred").length,
    pr: prStep?.data.pr ?? null,
    mergeSha: mergeStep?.data.sha ?? null,
  };
}

export async function getIncident(repo: Repo, n: number): Promise<Incident | null> {
  const issue = await repo.getIssue(n);
  if (!parseIssueBody(issue.body) && !parseRepairBody(issue.body)) return null;
  const comments = await repo.listComments(n);
  const steps = comments.map((c) => parseStep(c.body, c.created_at)).filter((s): s is Step => s !== null);
  return buildIncident(issue, steps);
}

/** Lista liviana para el panel (sin leer comentarios de cada issue). */
export async function listIncidents(repo: Repo): Promise<IncidentSummary[]> {
  const issues = await repo.listIncidentIssues("all");
  return issues
    .filter((i) => parseIssueBody(i.body))
    .map((i) => ({ number: i.number, title: i.title, createdAt: i.created_at, open: i.state === "open", stopped: i.state === "closed" && i.state_reason === "not_planned" }));
}

// ── Reparaciones de hallazgos ─────────────────────────────────
//
// Mismo ciclo que un incidente (issue + PR + CI + revisor + merge), pero el
// punto de partida es un análisis: las pruebas reproducen el hallazgo en vez
// de un error, y la verificación vuelve a analizar producción.

const REPAIR_MARKER = /^<!-- autosana-repair:(\{[\s\S]*?\}) -->/;

export function parseRepairBody(body: string | null): RepairInfo | null {
  const m = body?.match(REPAIR_MARKER);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as RepairInfo;
  } catch {
    return null;
  }
}

function repairBody(info: RepairInfo): string {
  return `<!-- autosana-repair:${safeJson(info)} -->
Fixie repara ${info.findings.length} hallazgos del análisis de **${REPAIR_LABEL[info.kind]}**${info.scoreBefore !== null ? ` (puntaje ${info.scoreBefore}/100)` : ""}.

| Gravedad | Hallazgo |
|---|---|
${info.findings.map((f) => `| ${f.severity} | ${f.title} |`).join("\n")}`;
}

export async function createRepair(repo: Repo, info: RepairInfo): Promise<Issue> {
  const n = info.findings.length;
  const issue = await repo.createIssue(`Fixie: reparar ${n} ${n === 1 ? "hallazgo" : "hallazgos"} de ${REPAIR_LABEL[info.kind]}`, repairBody(info));
  await postStep(repo, issue.number, "detected", `El análisis de ${REPAIR_LABEL[info.kind]} encontró ${n} ${n === 1 ? "hallazgo" : "hallazgos"} que Fixie puede reparar.`);
  return issue;
}

export async function listRepairs(repo: Repo): Promise<RepairSummary[]> {
  const issues = await repo.listIncidentIssues("all");
  return issues.flatMap((i) => {
    const info = parseRepairBody(i.body);
    return info
      ? [
          {
            number: i.number,
            title: i.title,
            createdAt: i.created_at,
            open: i.state === "open",
            kind: info.kind,
            findingIds: info.findings.map((f) => f.id),
            outcome: i.state === "open" ? ("open" as const) : i.state_reason === "completed" ? ("completed" as const) : ("not_planned" as const),
          },
        ]
      : [];
  });
}
