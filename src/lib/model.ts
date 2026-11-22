// Modelo de incidentes sin dependencias de servidor: lo usan la API, el
// panel (navegador) y la simulación.

export type IncidentPayload = {
  name: string;
  message: string;
  stack: string | null;
  digest: string | null;
  request: { path: string; method: string };
  route: { path: string; type: string };
  commit: string | null;
};

// ── Pasos: cada uno es un comentario del issue ────────────────
//
// Ciclo en el entorno de pruebas (CI del repo):
//   1. El agente escribe una prueba que reproduce el error → CI debe FALLAR sin arreglo.
//   2. Agrega el arreglo → CI debe pasar.
//   3. Otro agente (revisor) intenta volver a romperlo con pruebas nuevas.
//      Si lo logra → se repara de nuevo (máximo MAX_ROUNDS rondas).
//      Si no → merge a main y verificación en producción.

export const STEP_KINDS = [
  "detected",
  "recurred",
  "diagnosing",
  "reading",
  "db_query",
  "diagnosis",
  "db_tested",
  "pr_opened",
  "reproduced",
  "not_reproduced",
  "ci_passed",
  "ci_failed",
  "fixing",
  "fix_pushed",
  "review_started",
  "review_pushed",
  "review_failed",
  "review_passed",
  "db_backup",
  "db_applied",
  "needs_review",
  "merged",
  "verified",
  "failed",
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export type StepData = {
  pr?: number;
  /** Commit al que se refiere el paso (prueba, arreglo, revisión o merge). */
  sha?: string;
  fixSha?: string;
  reviewSha?: string;
  round?: number;
  path?: string;
  /** Puntaje del re-análisis en producción (reparaciones). */
  score?: number;
};
export type Step = { kind: StepKind; text: string; data: StepData; at: string };

export const MAX_ROUNDS = 3;

// ── Etapas para la UI ─────────────────────────────────────────

export const STAGES = ["detectado", "diagnosticando", "reproduciendo", "arreglando", "revisando", "desplegando", "verificado"] as const;
export type Stage = (typeof STAGES)[number] | "fallido" | "revision";

const STAGE_OF: Partial<Record<StepKind, (typeof STAGES)[number]>> = {
  detected: "detectado",
  diagnosing: "diagnosticando",
  reading: "diagnosticando",
  db_query: "diagnosticando",
  diagnosis: "diagnosticando",
  db_tested: "diagnosticando",
  pr_opened: "reproduciendo",
  reproduced: "arreglando",
  ci_failed: "arreglando",
  fixing: "arreglando",
  fix_pushed: "arreglando",
  ci_passed: "revisando",
  review_started: "revisando",
  review_pushed: "revisando",
  // El revisor volvió a romperlo: el ciclo regresa a arreglar.
  review_failed: "arreglando",
  review_passed: "desplegando",
  db_backup: "desplegando",
  db_applied: "desplegando",
  merged: "desplegando",
  verified: "verificado",
};

export function deriveStage(steps: Step[]): Stage {
  const kinds = new Set(steps.map((s) => s.kind));
  if (kinds.has("verified")) return "verificado";
  if (kinds.has("failed")) return "fallido";
  if (kinds.has("needs_review") || kinds.has("not_reproduced")) return "revision";
  for (let i = steps.length - 1; i >= 0; i--) {
    const stage = STAGE_OF[steps[i].kind];
    if (stage) return stage;
  }
  return "detectado";
}

/** Ronda actual del ciclo arreglar → revisar (1 = primer intento). */
export function currentRound(steps: Step[]): number {
  return Math.max(1, ...steps.map((s) => s.data.round ?? 1));
}

/** Una reparación de hallazgos (pentesting, conversión o Lighthouse) en vez de un error. */
export type RepairKind = "errors" | "pentest" | "pentest_deep" | "conversion" | "lighthouse" | "deps";
export type RepairFinding = {
  id: string;
  title: string;
  severity: string;
  detail: string;
  fix?: string;
  pkg?: { name: string; from: string; to: string };
  copy?: { from: string; to: string };
};
export type RepairInfo = { kind: RepairKind; scanId: string; scoreBefore: number | null; findings: RepairFinding[] };

export const REPAIR_LABEL: Record<RepairKind, string> = {
  errors: "Errores",
  pentest: "Pentesting",
  pentest_deep: "Pentest profundo",
  conversion: "Conversión",
  lighthouse: "Lighthouse",
  deps: "Dependencias",
};

export type Incident = {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  payload: IncidentPayload | null;
  repair: RepairInfo | null;
  steps: Step[];
  stage: Stage;
  round: number;
  occurrences: number;
  pr: number | null;
  mergeSha: string | null;
};

export type PullFile = { filename: string; status: string; additions: number; deletions: number; patch?: string };

export type IncidentSummary = { number: number; title: string; createdAt: string; open: boolean };
/** outcome: cómo terminó (completed = mergeado; not_planned = falló o quedó para un humano). */
export type RepairSummary = IncidentSummary & { kind: RepairKind; findingIds: string[]; outcome: "open" | "completed" | "not_planned" };

export type IncidentData = { incident: Incident; diff: PullFile[] };
