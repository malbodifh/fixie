// Planes y consumo de IA. Sin dependencias de servidor: lo usan el servidor
// (para frenar al agente) y el panel de Uso (para mostrarlo).

export type Plan = "free" | "pro" | "max" | "enterprise";
export const PLAN_ORDER: Plan[] = ["free", "pro", "max", "enterprise"];

/** 1 crédito = US$0.01 de consumo del modelo (DeepSeek). */
const CREDIT_USD = 0.01;

/**
 * Créditos por ciclo de 30 días. El más alto nunca pasa de US$10 de DeepSeek
 * por ciclo, ni siquiera con el consumo extra de los errores críticos.
 * Propuesta inicial: los precios de los planes todavía no están definidos.
 */
export const PLANS: Record<Plan, { label: string; monthlyCredits: number; criticalOverage: boolean }> = {
  free: { label: "Free", monthlyCredits: 50, criticalOverage: false },
  pro: { label: "Pro", monthlyCredits: 1000, criticalOverage: true },
  max: { label: "Max", monthlyCredits: 1000, criticalOverage: true },
  enterprise: { label: "Enterprise", monthlyCredits: 1000, criticalOverage: true },
};

/** Tope absoluto por ciclo para cualquier plan: US$10 de DeepSeek. */
const MAX_CYCLE_CREDITS = 1000;
/** Un paso del agente cuesta como mucho esto; se reserva para no cruzar nunca el tope absoluto. */
const STEP_RESERVE_CREDITS = 10;

const DAY_MS = 86_400_000;
export const CYCLE_DAYS = 30;
/**
 * El ciclo se reparte en 4 semanas desde el día de pago, con el mismo presupuesto
 * cada una (US$2.50 en los planes de pago). La última absorbe los 2 días que sobran.
 */
const WEEK_DAYS = [7, 7, 7, 9];
export const WEEKS_PER_CYCLE = WEEK_DAYS.length;

export type Week = {
  index: number;
  start: number;
  end: number;
  /** Créditos de esta semana antes de descontar deuda. */
  budget: number;
  /** Consumo extra de la semana anterior que se descuenta de esta. */
  debt: number;
  spent: number;
  remaining: number;
};

export type Budget = {
  plan: Plan;
  cycleStart: number;
  cycleEnd: number;
  cap: number;
  cycleSpent: number;
  weeks: Week[];
  current: Week;
};

export function computeBudget(rawPlan: Plan | null, anchor: number, now: number, events: { at: number; credits: number }[]): Budget {
  // Un plan vacío o desconocido en la base cuenta como Free (no como un error que frene todo).
  const plan: Plan = rawPlan && rawPlan in PLANS ? rawPlan : "free";
  const cap = PLANS[plan].monthlyCredits;
  // Sin Math.max: si el ancla queda en el futuro (pago fechado más adelante), el ciclo vigente es el anterior a ella.
  const cycles = Math.floor((now - anchor) / (CYCLE_DAYS * DAY_MS));
  const cycleStart = anchor + cycles * CYCLE_DAYS * DAY_MS;
  const cycleEnd = cycleStart + CYCLE_DAYS * DAY_MS;

  const weeks: Week[] = [];
  let start = cycleStart;
  let carry = 0;
  for (const [index, days] of WEEK_DAYS.entries()) {
    const end = start + days * DAY_MS;
    const budget = cap / WEEKS_PER_CYCLE;
    const spent = events.filter((e) => e.at >= start && e.at < end).reduce((s, e) => s + e.credits, 0);
    const remaining = budget - carry - spent;
    weeks.push({ index, start, end, budget, debt: carry, spent, remaining });
    carry = Math.max(0, -remaining);
    start = end;
  }
  const current = weeks.find((w) => now >= w.start && now < w.end) ?? weeks[weeks.length - 1];
  const cycleSpent = weeks.reduce((s, w) => s + w.spent, 0);
  return { plan, cycleStart, cycleEnd, cap, cycleSpent, weeks, current };
}

export type Allowance = { ok: true; overage: boolean } | { ok: false; reason: "week" | "cycle"; resumeAt: number };

/**
 * ¿Puede el agente gastar ahora?
 * - Con créditos en la semana: sí.
 * - Sin créditos: solo un error crítico, y solo en la semana 1 o 2 tras el pago.
 *   Ese extra se descuenta de la semana siguiente.
 * - El tope del ciclo no se cruza nunca, sea crítico o no.
 */
export function allowance(b: Budget, critical: boolean, reserve = STEP_RESERVE_CREDITS): Allowance {
  if (b.cycleSpent >= b.cap || b.cycleSpent + reserve >= MAX_CYCLE_CREDITS) return { ok: false, reason: "cycle", resumeAt: b.cycleEnd };
  if (b.current.remaining > 0) return { ok: true, overage: false };
  if (critical && PLANS[b.plan].criticalOverage && b.current.index <= 1) return { ok: true, overage: true };
  return { ok: false, reason: "week", resumeAt: b.current.end };
}

export const credits = (usd: number) => usd / CREDIT_USD;

/** Cobertura de vulnerabilidades conocidas: incluida en los planes de pago. */
export const coversKnownVulns = (plan: Plan) => plan !== "free";
export const KNOWN_VULNS_UPSELL = "La vigilancia de vulnerabilidades conocidas está incluida en Pro, Max y Enterprise.";

/** "29 de noviembre" en la hora de Ciudad de México. */
export function dayLabel(ms: number): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "America/Mexico_City" }).format(ms);
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "21 nov" en la hora de Ciudad de México. */
export function shortDay(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "numeric", timeZone: "America/Mexico_City" }).formatToParts(ms);
  const day = parts.find((p) => p.type === "day")?.value;
  const month = Number(parts.find((p) => p.type === "month")?.value ?? 1);
  return `${day} ${MONTHS[month - 1]}`;
}

/** Créditos para mostrar: enteros, salvo cantidades chicas. */
export function fmtCredits(n: number): string {
  const v = Math.max(0, n);
  return v > 0 && v < 10 ? v.toLocaleString("es-MX", { maximumFractionDigits: 1 }) : Math.round(v).toLocaleString("es-MX");
}
