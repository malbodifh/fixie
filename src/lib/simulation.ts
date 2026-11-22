import { currentRound, deriveStage, type IncidentData, type Step, type StepData, type StepKind } from "./model";

/**
 * Simulación de un incidente completo, sin backend. Sirve para diseñar el
 * panel y como plan B en la demo si falla la red.
 */
export const SIM_NUMBER = 42;

const SCRIPT: { t: number; kind: StepKind; text: string; data?: StepData }[] = [
  { t: 0, kind: "detected", text: "Error detectado en `/api/checkout/route`." },
  { t: 1.5, kind: "diagnosing", text: "Analizando el stack y leyendo el código…" },
  { t: 3, kind: "reading", text: "Leyendo `src/app/api/checkout/route.ts`", data: { path: "src/app/api/checkout/route.ts" } },
  { t: 4.5, kind: "reading", text: "Leyendo `src/lib/pricing.ts`", data: { path: "src/lib/pricing.ts" } },
  { t: 6, kind: "reading", text: "Leyendo `tests/pricing.test.ts`", data: { path: "tests/pricing.test.ts" } },
  {
    t: 8,
    kind: "diagnosis",
    text: "**Causa raíz:** applyCoupon busca el código tal cual llega. \"verano10\" no existe en COUPONS, coupon queda undefined y leer percent revienta.\n\n**Arreglo:** normalizar el código (trim + mayúsculas). Cupón desconocido devuelve error 400 claro, no 500.",
  },
  { t: 10, kind: "pr_opened", text: "PR #7 abierto en el entorno de pruebas. Primero corre la prueba SIN arreglo para reproducir el error…", data: { pr: 7, round: 1 } },
  { t: 16, kind: "reproduced", text: "Reproducido: la prueba falla sin el arreglo, igual que en producción.", data: { round: 1 } },
  { t: 22, kind: "ci_passed", text: "Con el arreglo, las pruebas pasan.", data: { round: 1 } },
  { t: 23, kind: "review_started", text: "Otro agente revisa el arreglo e intenta volver a romperlo…", data: { round: 1 } },
  { t: 27, kind: "review_pushed", text: "El revisor agregó 3 pruebas: minúsculas, espacios y cupón vacío.", data: { round: 1 } },
  { t: 32, kind: "review_failed", text: "El revisor volvió a romperlo: un cupón de solo espacios (\"   \") revienta. A reparar de nuevo.", data: { round: 1 } },
  { t: 33, kind: "fixing", text: "Ronda 2: corrigiendo con las pruebas del revisor…", data: { round: 2 } },
  { t: 36, kind: "fix_pushed", text: "Arreglo v2: un cupón vacío se ignora en vez de fallar.", data: { round: 2 } },
  { t: 42, kind: "ci_passed", text: "Todas las pruebas pasan, incluidas las del revisor.", data: { round: 2 } },
  { t: 43, kind: "review_started", text: "El revisor intenta romperlo otra vez…", data: { round: 2 } },
  { t: 47, kind: "review_pushed", text: "El revisor agregó 2 pruebas más: cupón null y cupón con tildes.", data: { round: 2 } },
  { t: 52, kind: "review_passed", text: "El revisor no logró reproducir el error. Aprobado.", data: { round: 2 } },
  { t: 54, kind: "merged", text: "PR #7 mergeado a main. Desplegando a producción…", data: { pr: 7, sha: "a1b2c3d4e5f6" } },
  { t: 62, kind: "verified", text: "Arreglo en producción (commit `a1b2c3d`).", data: { sha: "a1b2c3d4e5f6" } },
];

export const SIM_DURATION_S = SCRIPT.at(-1)!.t;

const DIFF = [
  {
    filename: "src/lib/pricing.ts",
    status: "modified",
    additions: 9,
    deletions: 2,
    patch: `@@ -13,6 +13,13 @@ export const COUPONS: Record<string, { percent: number }> = {
   HACK25: { percent: 25 },
 };

+export class InvalidCouponError extends Error {
+  constructor(code: string) {
+    super(\`Cupón inválido: \${code}\`);
+    this.name = "InvalidCouponError";
+  }
+}
+
 export function subtotal(items: CartItem[]): number {
@@ -25,8 +32,10 @@ export function subtotal(items: CartItem[]): number {
 export function applyCoupon(amount: number, code?: string): number {
-  if (!code) return amount;
-  const coupon = COUPONS[code];
+  const normalized = code?.trim().toUpperCase();
+  if (!normalized) return amount;
+  const coupon = COUPONS[normalized];
+  if (!coupon) throw new InvalidCouponError(code!);
   return amount * (1 - coupon.percent / 100);
 }`,
  },
  {
    filename: "tests/coupon-normalization.test.ts",
    status: "added",
    additions: 14,
    deletions: 0,
    patch: `@@ -0,0 +1,14 @@
+import { describe, expect, it } from "vitest";
+import { applyCoupon, InvalidCouponError } from "@/lib/pricing";
+
+describe("applyCoupon normaliza el código", () => {
+  it("acepta minúsculas y espacios", () => {
+    expect(applyCoupon(100, "verano10")).toBe(90);
+    expect(applyCoupon(100, "  VERANO10 ")).toBe(90);
+  });
+
+  it("rechaza cupones desconocidos sin reventar", () => {
+    expect(() => applyCoupon(100, "NOEXISTE")).toThrow(InvalidCouponError);
+  });
+});`,
  },
  {
    filename: "tests/autosana-revision-7.test.ts",
    status: "added",
    additions: 15,
    deletions: 0,
    patch: `@@ -0,0 +1,15 @@
+// Pruebas del agente revisor: intentan volver a romper el arreglo.
+import { describe, expect, it } from "vitest";
+import { applyCoupon } from "@/lib/pricing";
+
+describe("revisión: entradas extremas del cupón", () => {
+  it("un cupón de solo espacios no revienta", () => {
+    expect(applyCoupon(100, "   ")).toBe(100);
+  });
+  it("un cupón null no revienta", () => {
+    expect(applyCoupon(100, null as unknown as string)).toBe(100);
+  });
+  it("minúsculas con espacios", () => {
+    expect(applyCoupon(100, " hack25 ")).toBe(75);
+  });
+});`,
  },
];

/** Estado del incidente simulado a los `elapsedMs` de haber empezado. */
export function simulatedSnapshot(startedAt: number, now: number): IncidentData {
  const elapsed = (now - startedAt) / 1000;
  const steps: Step[] = SCRIPT.filter((s) => s.t <= elapsed).map((s) => ({
    kind: s.kind,
    text: s.text,
    data: s.data ?? {},
    at: new Date(startedAt + s.t * 1000).toISOString(),
  }));
  const pr = steps.some((s) => s.kind === "pr_opened") ? 7 : null;
  const merged = steps.find((s) => s.kind === "merged");

  return {
    incident: {
      number: SIM_NUMBER,
      title: "TypeError: Cannot read properties of undefined (reading 'percent')",
      url: "https://github.com/autosana/devshop/issues/42",
      createdAt: new Date(startedAt).toISOString(),
      payload: {
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'percent')",
        stack: "TypeError: Cannot read properties of undefined (reading 'percent')\n    at applyCoupon (src/lib/pricing.ts:28:33)\n    at quote (src/lib/pricing.ts:44:17)\n    at POST (src/app/api/checkout/route.ts:18:18)",
        digest: null,
        request: { path: "/api/checkout", method: "POST" },
        route: { path: "/api/checkout/route", type: "route" },
        commit: "9f8e7d6",
      },
      repair: null,
      steps,
      stage: deriveStage(steps),
      round: currentRound(steps),
      occurrences: elapsed > 9 ? 3 : 1,
      pr,
      mergeSha: merged?.data.sha ?? null,
    },
    diff: pr ? DIFF : [],
  };
}
