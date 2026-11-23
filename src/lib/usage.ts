import "server-only";
import { APICallError, type LanguageModelUsage } from "ai";
import { modelName } from "./agent/model";
import { db, must, type ProjectRow, type UserRow } from "./db";
import type { RepairInfo } from "./model";
import { allowance, computeBudget, credits, dayLabel, type Allowance, type Budget, type Plan } from "./plans";

/**
 * Consumo de IA por usuario. Cada paso del agente se registra con su costo y,
 * en cuanto se llega al límite del plan, el agente se detiene aunque esté a
 * mitad de un trabajo. Lo que no usa IA (análisis, dependencias) no consume.
 */

export type UsageKind = "incident" | "repair" | "review" | "daily_review" | "copy" | "chat";

/** Precios de DeepSeek V4.1 Flash por millón de tokens (tarifa en hora pico: la más alta, para no quedarse corto). */
const PRICE_PER_M = { input: 0.3, cachedInput: 0.006, output: 1.2 };

function costUsd(usage: LanguageModelUsage): number {
  const input = usage.inputTokens ?? 0;
  const cached = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return ((input - cached) * PRICE_PER_M.input + cached * PRICE_PER_M.cachedInput + output * PRICE_PER_M.output) / 1_000_000;
}

/** Un error de producción es crítico; una reparación, solo si tiene hallazgos críticos. */
export const isCriticalWork = (repair: RepairInfo | null) => !repair || repair.findings.some((f) => f.severity === "critico");

export class BudgetExceededError extends Error {
  constructor(
    readonly reason: "week" | "cycle",
    readonly resumeAt: number,
  ) {
    super(
      reason === "cycle"
        ? `Llegaste al límite de consumo de tu plan en este ciclo. Fixie lo retoma el ${dayLabel(resumeAt)}.`
        : `Llegaste al límite de consumo de tu plan esta semana. Fixie lo retoma el ${dayLabel(resumeAt)}.`,
    );
  }
}

type PlanUser = Pick<UserRow, "id" | "plan" | "plan_started_at" | "created_at">;

async function planUser(userId: string): Promise<PlanUser> {
  return must(await db().from("users").select("id, plan, plan_started_at, created_at").eq("id", userId).single()) as PlanUser;
}

/**
 * Todas las filas de una consulta, página por página. PostgREST corta cada
 * respuesta en `max-rows` (1000 en Supabase): sin paginar, un usuario con
 * muchos pasos en el ciclo vería solo una parte de su consumo y podría pasarse
 * del tope.
 */
const PAGE = 1000;
async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null; count: number | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const res = await page(rows.length, rows.length + PAGE - 1);
    const chunk = must(res) ?? [];
    rows.push(...chunk);
    // El total exacto evita una vuelta de más; si el servidor devuelve menos de lo pedido, se sigue pidiendo.
    if (chunk.length === 0 || (res.count !== null && rows.length >= res.count)) return rows;
  }
}

/** Consumo de un usuario desde una fecha, en orden estable para poder paginar. */
function usageRows<T>(userId: string, since: number, columns: string): Promise<T[]> {
  return allRows<T>((from, to) =>
    db()
      .from("usage_events")
      .select(columns, { count: "exact" })
      .eq("user_id", userId)
      .gte("created_at", new Date(since).toISOString())
      .order("created_at", { ascending: true })
      .range(from, to)
      .returns<T[]>(),
  );
}

/** El consumo del ciclo actual, semana por semana. */
export async function budgetFor(user: PlanUser, now = Date.now()): Promise<Budget> {
  // Una fecha de pago ilegible no puede dejar el ciclo en NaN (y el límite sin efecto): cuenta desde el registro.
  const paid = user.plan_started_at ? Date.parse(user.plan_started_at) : NaN;
  const anchor = Number.isFinite(paid) ? paid : Date.parse(user.created_at);
  const { cycleStart } = computeBudget(user.plan, anchor, now, []);
  const rows = await usageRows<{ created_at: string; cost_usd: number | string }>(user.id, cycleStart, "created_at, cost_usd");
  const events = rows.map((r) => ({ at: Date.parse(r.created_at), credits: credits(Number(r.cost_usd)) }));
  return computeBudget(user.plan, anchor, now, events);
}

/** El plan del dueño de un proyecto. */
export async function planOf(userId: string): Promise<Plan> {
  const { data } = await db().from("users").select("plan").eq("id", userId).maybeSingle<{ plan: Plan }>();
  return data?.plan ?? "free";
}

export async function checkAllowance(ownerId: string, critical: boolean): Promise<Allowance> {
  return allowance(await budgetFor(await planUser(ownerId)), critical);
}

export type MeterHooks = {
  /** Va en stopWhen: corta el bucle del agente en cuanto se llega al límite. */
  stopWhen: () => boolean;
  /** Va en onStepEnd: registra el costo de cada paso. */
  onStepEnd: (step: { usage: LanguageModelUsage; model?: { modelId: string } }) => Promise<void>;
};

/**
 * Abre un medidor: si no hay créditos lanza BudgetExceededError; si los hay,
 * devuelve los ganchos que registran cada paso y cortan al llegar al límite.
 */
export async function startMeter(opts: { ownerId: string; projectId: string | null; kind: UsageKind; critical: boolean; incident?: number }) {
  const user = await planUser(opts.ownerId);
  const first = allowance(await budgetFor(user), opts.critical);
  if (!first.ok) throw new BudgetExceededError(first.reason, first.resumeAt);

  let stopped: Extract<Allowance, { ok: false }> | null = null;
  const hooks: MeterHooks = {
    stopWhen: () => stopped !== null,
    onStepEnd: async ({ usage, model }) => {
      const cost = costUsd(usage);
      await db()
        .from("usage_events")
        .insert({
          user_id: user.id,
          project_id: opts.projectId,
          kind: opts.kind,
          incident: opts.incident ?? null,
          critical: opts.critical,
          // El modelo que corrió este paso (el rápido o el del agente), no el configurado por defecto.
          model: model?.modelId ?? modelName(),
          input_tokens: usage.inputTokens ?? 0,
          cached_tokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
          output_tokens: usage.outputTokens ?? 0,
          cost_usd: cost.toFixed(6),
        })
        .then(({ error }) => error && console.error("[uso] no pude registrar el consumo", error.message));
      // Se vuelve a leer de la base: otros trabajos del mismo usuario también consumen.
      const now = allowance(await budgetFor(user), opts.critical);
      if (!now.ok) stopped = now;
    },
  };
  return { hooks, halted: () => stopped as Extract<Allowance, { ok: false }> | null };
}

/**
 * Corre un trabajo del agente midiendo su consumo. Si no hay créditos ni
 * siquiera empieza; si se acaban a la mitad, se detiene tras ese paso y lanza
 * BudgetExceededError (salvo que el trabajo ya haya terminado, `done`).
 */
export async function metered<T>(
  opts: { project: Pick<ProjectRow, "id" | "owner_id">; kind: UsageKind; critical: boolean; incident?: number; done?: () => boolean },
  run: (hooks: MeterHooks) => Promise<T>,
): Promise<T> {
  const meter = await startMeter({ ownerId: opts.project.owner_id, projectId: opts.project.id, kind: opts.kind, critical: opts.critical, incident: opts.incident });
  const result = await run(meter.hooks).catch((err: unknown) => {
    throw providerError(err);
  });
  const halt = meter.halted();
  if (halt && !opts.done?.()) throw new BudgetExceededError(halt.reason, halt.resumeAt);
  return result;
}

/** Los errores del proveedor del modelo, explicados para el panel. */
export function providerError(err: unknown): unknown {
  if (!APICallError.isInstance(err)) return err;
  if (err.statusCode === 401 || err.statusCode === 403) return new Error("La clave de DeepSeek no es válida. Revisa DEEPSEEK_API_KEY en la configuración del servidor.");
  if (err.statusCode === 402) return new Error("La cuenta de DeepSeek se quedó sin saldo. Recárgala en platform.deepseek.com.");
  if (err.statusCode === 429) return new Error("DeepSeek está limitando las peticiones. Fixie lo reintenta en la próxima revisión.");
  if ((err.statusCode ?? 0) >= 500) return new Error("DeepSeek no respondió. Fixie lo reintenta en la próxima revisión.");
  return err;
}

export type UsageEvent = { project_id: string | null; kind: UsageKind; cost_usd: number | string; input_tokens: number; output_tokens: number };

/** Cada registro de consumo desde una fecha (para el desglose del panel de Uso). */
export function usageEventsSince(userId: string, since: number): Promise<UsageEvent[]> {
  return usageRows<UsageEvent>(userId, since, "project_id, kind, cost_usd, input_tokens, output_tokens");
}
