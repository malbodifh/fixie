import { currentRound, deriveStage, type IncidentData, type PullFile, type RepairInfo, type RepairKind, type Step, type StepData, type StepKind } from "./model";

/**
 * Simulación de una reparación de hallazgos, sin backend: el mismo ciclo que un
 * incidente (reproducir, reparar, el revisor lo ataca, merge y re-análisis).
 * Sirve para la demo y como plan B si no hay clave del modelo.
 */
export const SIM_REPAIR_NUMBER = 43;

type Script = { t: number; kind: StepKind; text: string; data?: StepData }[];

const SIM: Record<RepairKind, { info: RepairInfo; script: Script; diff: PullFile[] }> = {
  pentest: {
    info: {
      kind: "pentest",
      scanId: "sim",
      scoreBefore: 40,
      findings: [
        { id: "csp", title: "Content-Security-Policy", severity: "alto", detail: "Sin CSP: un XSS puede ejecutar cualquier script." },
        { id: "clickjacking", title: "Protección contra clickjacking", severity: "medio", detail: "Otra web puede incrustar tu app en un iframe." },
        { id: "nosniff", title: "X-Content-Type-Options", severity: "bajo", detail: "El navegador puede adivinar tipos de archivo." },
        { id: "referrer", title: "Referrer-Policy", severity: "bajo", detail: "Las URLs completas pueden filtrarse." },
        { id: "permissions", title: "Permissions-Policy", severity: "bajo", detail: "Scripts de terceros pueden pedir cámara o micrófono." },
        { id: "banner", title: "No revela la tecnología del servidor", severity: "bajo", detail: "Responde con X-Powered-By: Next.js." },
      ],
    },
    script: [
      { t: 0, kind: "detected", text: "El análisis de Pentesting encontró 6 hallazgos que Fixie puede reparar." },
      { t: 1.5, kind: "diagnosing", text: "Leyendo el código para reparar los hallazgos…" },
      { t: 3, kind: "reading", text: "Leyendo `next.config.ts`", data: { path: "next.config.ts" } },
      { t: 4.5, kind: "reading", text: "Leyendo `src/app/layout.tsx`", data: { path: "src/app/layout.tsx" } },
      {
        t: 7,
        kind: "diagnosis",
        text: "**Reparación:** cabeceras de seguridad en next.config para todas las rutas (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) y poweredByHeader: false.",
      },
      { t: 9, kind: "pr_opened", text: "PR #8 abierto en el entorno de pruebas. Primero corren las pruebas SIN la reparación para reproducir los hallazgos…", data: { pr: 8, round: 1 } },
      { t: 15, kind: "reproduced", text: "Reproducido: las pruebas fallan sin la reparación; faltan las 5 cabeceras y el servidor revela Next.js.", data: { round: 1 } },
      { t: 20, kind: "ci_passed", text: "Con la reparación, las pruebas pasan.", data: { round: 1 } },
      { t: 21, kind: "review_started", text: "Otro agente intenta demostrar que la reparación está incompleta o rompe la app…", data: { round: 1 } },
      { t: 25, kind: "review_pushed", text: "El revisor agregó 2 pruebas: la CSP no debe bloquear los scripts de Next y debe aplicarse también a /api.", data: { round: 1 } },
      { t: 30, kind: "review_failed", text: "El revisor lo rompió: script-src 'self' bloquea los scripts inline de Next y la tienda dejaría de funcionar. A reparar de nuevo.", data: { round: 1 } },
      { t: 31, kind: "fixing", text: "Ronda 2: corrigiendo con las pruebas del revisor…", data: { round: 2 } },
      { t: 35, kind: "fix_pushed", text: "Reparación v2: nonce por petición en src/proxy.ts; la CSP permite solo scripts con ese nonce.", data: { round: 2 } },
      { t: 40, kind: "ci_passed", text: "Todas las pruebas pasan, incluidas las del revisor.", data: { round: 2 } },
      { t: 41, kind: "review_started", text: "El revisor intenta romperlo otra vez…", data: { round: 2 } },
      { t: 45, kind: "review_pushed", text: "El revisor agregó 1 prueba más: un iframe externo no puede incrustar la tienda.", data: { round: 2 } },
      { t: 49, kind: "review_passed", text: "El revisor no logró romper la reparación. Aprobada.", data: { round: 2 } },
      { t: 51, kind: "merged", text: "PR #8 mergeado a main. Desplegando a producción…", data: { pr: 8, sha: "b7c8d9e0f1a2" } },
      { t: 58, kind: "verified", text: "Re-análisis de Pentesting en producción: 6 de 6 hallazgos resueltos. Puntaje 40 → 96.", data: { sha: "b7c8d9e0f1a2", score: 96 } },
    ],
    diff: [
      {
        filename: "next.config.ts",
        status: "modified",
        additions: 16,
        deletions: 0,
        patch: `@@ -1,6 +1,22 @@
 import type { NextConfig } from "next";

 const nextConfig: NextConfig = {
+  poweredByHeader: false,
+  async headers() {
+    return [
+      {
+        source: "/(.*)",
+        headers: [
+          { key: "X-Frame-Options", value: "DENY" },
+          { key: "X-Content-Type-Options", value: "nosniff" },
+          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
+          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
+        ],
+      },
+    ];
+  },
 };`,
      },
      {
        filename: "src/proxy.ts",
        status: "added",
        additions: 14,
        deletions: 0,
        patch: `@@ -0,0 +1,14 @@
+import { NextResponse, type NextRequest } from "next/server";
+
+export function proxy(request: NextRequest) {
+  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
+  const csp = \`default-src 'self'; script-src 'self' 'nonce-\${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'\`;
+  const headers = new Headers(request.headers);
+  headers.set("x-nonce", nonce);
+  const response = NextResponse.next({ request: { headers } });
+  response.headers.set("Content-Security-Policy", csp);
+  return response;
+}
+
+export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" };`,
      },
      {
        filename: "tests/autosana-revision-8.test.ts",
        status: "added",
        additions: 9,
        deletions: 0,
        patch: `@@ -0,0 +1,9 @@
+// Pruebas del agente revisor: intentan demostrar que la reparación rompe la app.
+import { expect, it } from "vitest";
+import { proxy } from "@/proxy";
+
+it("la CSP permite los scripts de Next con nonce", async () => {
+  const res = proxy(new Request("https://tienda.test/") as never);
+  expect(res.headers.get("Content-Security-Policy")).toMatch(/script-src[^;]*'nonce-/);
+  expect(res.headers.get("Content-Security-Policy")).not.toMatch(/script-src 'self';/);
+});`,
      },
    ],
  },
  conversion: {
    info: {
      kind: "conversion",
      scanId: "sim",
      scoreBefore: 62,
      findings: [
        { id: "cta", title: "Acción principal clara", severity: "alto", detail: "No hay un botón con una acción concreta." },
        { id: "form-labels", title: "Campos de formulario con etiqueta", severity: "medio", detail: "2 de 3 campos sin etiqueta." },
        { id: "input-types", title: "Teclado y autocompletado correctos", severity: "bajo", detail: "El correo usa type=\"text\"." },
        { id: "social-preview", title: "Vista previa al compartir", severity: "bajo", detail: "Falta og:image y og:description." },
      ],
    },
    script: [
      { t: 0, kind: "detected", text: "Elegiste 4 cambios de Conversión. Fixie los aplica en el entorno de pruebas." },
      { t: 1.5, kind: "diagnosing", text: "Leyendo el código para reparar los hallazgos…" },
      { t: 3, kind: "reading", text: "Leyendo `src/app/page.tsx`", data: { path: "src/app/page.tsx" } },
      { t: 4.5, kind: "reading", text: "Leyendo `src/app/shop.tsx`", data: { path: "src/app/shop.tsx" } },
      {
        t: 7,
        kind: "diagnosis",
        text: "**Reparación:** botón \"Agregar al carrito\" en cada producto, etiquetas visibles y type=\"email\" con autocompletado en el checkout, y openGraph en el layout.",
      },
      { t: 9, kind: "pr_opened", text: "PR #9 abierto en el entorno de pruebas. Primero corren las pruebas SIN la reparación para reproducir los hallazgos…", data: { pr: 9, round: 1 } },
      { t: 15, kind: "reproduced", text: "Reproducido: las pruebas fallan sin la reparación; no hay botón de acción y 2 campos no tienen etiqueta.", data: { round: 1 } },
      { t: 20, kind: "ci_passed", text: "Con la reparación, las pruebas pasan.", data: { round: 1 } },
      { t: 21, kind: "review_started", text: "Otro agente intenta demostrar que la reparación está incompleta…", data: { round: 1 } },
      { t: 25, kind: "review_pushed", text: "El revisor agregó 2 pruebas: el formulario del cupón y la página de producto también deben tener etiquetas.", data: { round: 1 } },
      { t: 30, kind: "review_passed", text: "El revisor no encontró huecos. Aprobada.", data: { round: 1 } },
      { t: 32, kind: "merged", text: "PR #9 mergeado a main. Desplegando a producción…", data: { pr: 9, sha: "c1d2e3f4a5b6" } },
      { t: 39, kind: "verified", text: "Re-análisis de Conversión en producción: 4 de 4 hallazgos resueltos. Puntaje 62 → 100.", data: { sha: "c1d2e3f4a5b6", score: 100 } },
    ],
    diff: [
      {
        filename: "src/app/shop.tsx",
        status: "modified",
        additions: 8,
        deletions: 3,
        patch: `@@ -41,9 +41,14 @@ export function Shop() {
-      <input placeholder="Tu correo" value={email} onChange={(e) => setEmail(e.target.value)} />
-      <input placeholder="Cupón" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
-      <button onClick={pay}>Continuar</button>
+      <label htmlFor="email">Correo para el recibo</label>
+      <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
+      <label htmlFor="coupon">Cupón de descuento</label>
+      <input id="coupon" autoComplete="off" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
+      <button onClick={pay}>Pagar ahora</button>`,
      },
      {
        filename: "src/app/layout.tsx",
        status: "modified",
        additions: 6,
        deletions: 0,
        patch: `@@ -6,6 +6,12 @@ export const metadata: Metadata = {
   title: "DevShop",
   description: "Tienda de equipo para desarrolladores",
+  openGraph: {
+    title: "DevShop",
+    description: "Tazas, audífonos y stickers para desarrolladores. Envío en 48 h.",
+    images: ["/og.png"],
+  },
 };`,
      },
    ],
  },
  errors: {
    info: {
      kind: "errors",
      scanId: "sim",
      scoreBefore: 65,
      findings: [
        { id: "page:/carrito", title: "/carrito falla", severity: "alto", detail: "Respondió 500 con la página de error. Cada visita a esta página termina en error." },
        { id: "bug:src/app/cart.tsx:total-con-cupon-vacio", title: "El total se rompe con un cupón vacío", severity: "medio", detail: "`src/app/cart.tsx:58`. Si el cupón no existe, `discount` es undefined y el total sale NaN." },
      ],
    },
    script: [
      { t: 0, kind: "detected", text: "Revisión de la 1:00 a. m.: 2 errores en producción. El cliente duerme; Fixie empieza." },
      { t: 1.5, kind: "diagnosing", text: "Leyendo el código para reparar los hallazgos…" },
      { t: 3, kind: "reading", text: "Leyendo `src/app/carrito/page.tsx`", data: { path: "src/app/carrito/page.tsx" } },
      { t: 4.5, kind: "reading", text: "Leyendo `src/app/cart.tsx`", data: { path: "src/app/cart.tsx" } },
      { t: 7, kind: "diagnosis", text: "**Reparación:** el carrito asume que `items` siempre existe; con la sesión vacía revienta. El total no maneja un cupón inexistente." },
      { t: 9, kind: "pr_opened", text: "PR #12 abierto en el entorno de pruebas. Primero corren las pruebas SIN la reparación…", data: { pr: 12, round: 1 } },
      { t: 15, kind: "reproduced", text: "Reproducido: el carrito vacío lanza TypeError y el total con cupón vacío da NaN.", data: { round: 1 } },
      { t: 20, kind: "ci_passed", text: "Con la reparación, las pruebas pasan.", data: { round: 1 } },
      { t: 21, kind: "review_started", text: "Otro agente intenta demostrar que la reparación está incompleta…", data: { round: 1 } },
      { t: 26, kind: "review_passed", text: "El revisor probó cupones con espacios y mayúsculas: todo en orden. Aprobada.", data: { round: 1 } },
      { t: 28, kind: "merged", text: "PR #12 mergeado a main a la 1:09 a. m. Desplegando…", data: { pr: 12, sha: "e1f2a3b4c5d6" } },
      { t: 35, kind: "verified", text: "Re-análisis de Errores en producción: 2 de 2 resueltos. Puntaje 65 → 100.", data: { sha: "e1f2a3b4c5d6", score: 100 } },
    ],
    diff: [
      {
        filename: "src/app/cart.tsx",
        status: "modified",
        additions: 3,
        deletions: 2,
        patch: `@@ -55,6 +55,7 @@ export function Cart({ items }: { items?: Item[] }) {
-  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
-  const total = subtotal - subtotal * discount;
+  const subtotal = (items ?? []).reduce((s, i) => s + i.price * i.qty, 0);
+  const rate = COUPONS[coupon.trim().toUpperCase()] ?? 0;
+  const total = subtotal - subtotal * rate;`,
      },
    ],
  },
  pentest_deep: {
    info: {
      kind: "pentest_deep",
      scanId: "sim",
      scoreBefore: 45,
      findings: [
        { id: "shannon:INJ-01", title: "Inyección SQL en GET /api/pedidos/{id}", severity: "critico", detail: "Explotada por Shannon en el entorno de pruebas. `src/app/api/pedidos/[id]/route.ts:14`." },
        { id: "shannon:AUTHZ-02", title: "Cualquier usuario ve pedidos ajenos", severity: "alto", detail: "Explotada por Shannon: cambiando el id se leen pedidos de otra cuenta." },
      ],
    },
    script: [
      { t: 0, kind: "detected", text: "Shannon terminó el pentest profundo: 2 vulnerabilidades explotadas en el entorno de pruebas." },
      { t: 1.5, kind: "diagnosing", text: "Leyendo el código para reparar los hallazgos…" },
      { t: 3, kind: "reading", text: "Leyendo `src/app/api/pedidos/[id]/route.ts`", data: { path: "src/app/api/pedidos/[id]/route.ts" } },
      { t: 7, kind: "diagnosis", text: "**Reparación:** consulta parametrizada en lugar de concatenar el id, y verificar que el pedido sea del usuario de la sesión." },
      { t: 9, kind: "pr_opened", text: "PR #14 abierto en el entorno de pruebas. Primero corren las pruebas SIN la reparación…", data: { pr: 14, round: 1 } },
      { t: 15, kind: "reproduced", text: "Reproducido: la prueba inyecta `1 OR 1=1` y lee todos los pedidos; otra lee un pedido ajeno.", data: { round: 1 } },
      { t: 20, kind: "ci_passed", text: "Con la reparación, las pruebas pasan.", data: { round: 1 } },
      { t: 21, kind: "review_started", text: "Otro agente intenta demostrar que la reparación está incompleta…", data: { round: 1 } },
      { t: 25, kind: "review_pushed", text: "El revisor probó un id negativo y uno con comillas: la ruta de cancelación tenía el mismo fallo.", data: { round: 1 } },
      { t: 26, kind: "fixing", text: "Ronda 2: corrigiendo con lo que falló…", data: { round: 2 } },
      { t: 31, kind: "ci_passed", text: "Con la reparación, las pruebas pasan, incluidas las del revisor.", data: { round: 2 } },
      { t: 34, kind: "review_passed", text: "El revisor no encontró más huecos. Aprobada.", data: { round: 2 } },
      { t: 36, kind: "merged", text: "PR #14 mergeado a main. Desplegando…", data: { pr: 14, sha: "f1a2b3c4d5e6" } },
      { t: 42, kind: "verified", text: "Desplegado. Las pruebas que reproducen cada explotación pasan; el próximo pentest profundo lo confirma.", data: { sha: "f1a2b3c4d5e6", score: 100 } },
    ],
    diff: [
      {
        filename: "src/app/api/pedidos/[id]/route.ts",
        status: "modified",
        additions: 4,
        deletions: 2,
        patch: `@@ -10,8 +10,10 @@ export async function GET(req: Request, ctx: RouteContext<"/api/pedidos/[id]">) {
   const { id } = await ctx.params;
-  const rows = await sql.unsafe(\`select * from pedidos where id = \${id}\`);
-  return Response.json(rows[0]);
+  const user = await requireUser();
+  if (!/^\\d+$/.test(id)) return Response.json({ error: "Id inválido" }, { status: 400 });
+  const [pedido] = await sql\`select * from pedidos where id = \${Number(id)} and user_id = \${user.id}\`;
+  return pedido ? Response.json(pedido) : Response.json({ error: "No encontrado" }, { status: 404 });`,
      },
    ],
  },
  deps: {
    info: {
      kind: "deps",
      scanId: "sim",
      scoreBefore: 65,
      findings: [
        {
          id: "dep:next:GHSA-f82v-jwr5-mffw",
          title: "next 15.2.2: Authorization Bypass in Next.js Middleware",
          severity: "critico",
          detail: "GHSA-f82v-jwr5-mffw · CVE-2025-29927 Dependencia directa. Corregida en 15.2.3.",
          pkg: { name: "next", from: "15.2.2", to: "15.2.3" },
        },
      ],
    },
    script: [
      { t: 0, kind: "detected", text: "Se publicó una vulnerabilidad crítica para una versión instalada: next 15.2.2 (CVE-2025-29927, omisión de autorización en el middleware)." },
      { t: 1.5, kind: "diagnosing", text: "Calculando la versión segura de cada paquete en el registro de npm…" },
      { t: 3, kind: "reading", text: "Leyendo `package.json` y `package-lock.json`", data: { path: "package-lock.json" } },
      { t: 5, kind: "diagnosis", text: "**Actualización:** next 15.2.2 → 15.2.3 (GHSA-f82v-jwr5-mffw). Mismo carril de versión, sin dependencias nuevas." },
      { t: 7, kind: "pr_opened", text: "PR #11 abierto en el entorno de pruebas. Primero corre la prueba con la versión vulnerable para reproducir el problema…", data: { pr: 11, round: 1 } },
      { t: 13, kind: "reproduced", text: "Reproducido: la prueba falla con next 15.2.2 instalado.", data: { round: 1 } },
      { t: 19, kind: "ci_passed", text: "Con next 15.2.3, CI pasa: tus pruebas, el typecheck y el build.", data: { round: 1 } },
      { t: 20, kind: "review_started", text: "Otro agente busca usos de next que puedan romperse con la versión nueva…", data: { round: 1 } },
      { t: 24, kind: "review_pushed", text: "El revisor agregó 2 pruebas: el middleware sigue protegiendo /admin y las rutas de la API.", data: { round: 1 } },
      { t: 28, kind: "review_passed", text: "El revisor no logró romper la actualización. Aprobada.", data: { round: 1 } },
      { t: 30, kind: "merged", text: "PR #11 mergeado a main. Desplegando a producción…", data: { pr: 11, sha: "e5f6a7b8c9d0" } },
      { t: 36, kind: "verified", text: "Re-revisión del lockfile de main: 0 vulnerabilidades conocidas. Puntaje 65 → 100.", data: { sha: "e5f6a7b8c9d0", score: 100 } },
    ],
    diff: [
      {
        filename: "package.json",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: `@@ -10,7 +10,7 @@
   "dependencies": {
-    "next": "15.2.2",
+    "next": "15.2.3",
     "react": "19.0.0",
     "react-dom": "19.0.0"
   },`,
      },
      {
        filename: "package-lock.json",
        status: "modified",
        additions: 3,
        deletions: 3,
        patch: `@@ -1802,9 +1802,9 @@
     "node_modules/next": {
-      "version": "15.2.2",
-      "resolved": "https://registry.npmjs.org/next/-/next-15.2.2.tgz",
-      "integrity": "sha512-…",
+      "version": "15.2.3",
+      "resolved": "https://registry.npmjs.org/next/-/next-15.2.3.tgz",
+      "integrity": "sha512-…",`,
      },
      {
        filename: "tests/fixie-dependencias-44.test.ts",
        status: "added",
        additions: 6,
        deletions: 0,
        patch: `@@ -0,0 +1,6 @@
+// Fixie: reproduce las dependencias vulnerables. Falla mientras siga instalada
+// una versión afectada y pasa con la actualización.
+describe("dependencias sin vulnerabilidades conocidas", () => {
+  it("next >= 15.2.3", () => {
+    expect(atLeast(installed("next"), "15.2.3")).toBe(true);
+  });`,
      },
    ],
  },
  lighthouse: {
    info: {
      kind: "lighthouse",
      scanId: "sim",
      scoreBefore: 71,
      findings: [
        { id: "render-blocking-resources", title: "Recursos que bloquean el renderizado", severity: "medio", detail: "Ahorro estimado de 900 ms." },
        { id: "uses-responsive-images", title: "Imágenes del tamaño correcto", severity: "medio", detail: "Ahorro estimado de 320 KiB." },
        { id: "color-contrast", title: "Contraste de color suficiente", severity: "bajo", detail: "3 textos con poco contraste." },
      ],
    },
    script: [
      { t: 0, kind: "detected", text: "El análisis de Lighthouse encontró 3 hallazgos que Fixie puede reparar." },
      { t: 1.5, kind: "diagnosing", text: "Leyendo el código para reparar los hallazgos…" },
      { t: 3, kind: "reading", text: "Leyendo `src/app/layout.tsx`", data: { path: "src/app/layout.tsx" } },
      { t: 6, kind: "diagnosis", text: "**Reparación:** scripts de terceros con next/script lazyOnload, imágenes con next/image y sizes, y colores de texto con contraste AA." },
      { t: 8, kind: "pr_opened", text: "PR #10 abierto en el entorno de pruebas…", data: { pr: 10, round: 1 } },
      { t: 14, kind: "reproduced", text: "Reproducido: las pruebas fallan sin la reparación.", data: { round: 1 } },
      { t: 19, kind: "ci_passed", text: "Con la reparación, las pruebas pasan.", data: { round: 1 } },
      { t: 20, kind: "review_started", text: "Otro agente intenta demostrar que la reparación está incompleta…", data: { round: 1 } },
      { t: 24, kind: "review_pushed", text: "El revisor agregó 1 prueba: las imágenes del carrito también usan next/image.", data: { round: 1 } },
      { t: 28, kind: "review_passed", text: "El revisor no encontró huecos. Aprobada.", data: { round: 1 } },
      { t: 30, kind: "merged", text: "PR #10 mergeado a main. Desplegando a producción…", data: { pr: 10, sha: "d4e5f6a7b8c9" } },
      { t: 37, kind: "verified", text: "Re-análisis de Lighthouse en producción: 3 de 3 hallazgos resueltos. Rendimiento 71 → 94.", data: { sha: "d4e5f6a7b8c9", score: 94 } },
    ],
    diff: [],
  },
};

export function simulatedRepair(kind: RepairKind, startedAt: number, now: number): IncidentData {
  const sim = SIM[kind];
  const elapsed = (now - startedAt) / 1000;
  const steps: Step[] = sim.script
    .filter((s) => s.t <= elapsed)
    .map((s) => ({ kind: s.kind, text: s.text, data: s.data ?? {}, at: new Date(startedAt + s.t * 1000).toISOString() }));
  const prStep = [...steps].reverse().find((s) => s.data.pr);
  const merged = steps.find((s) => s.kind === "merged");
  const n = sim.info.findings.length;
  return {
    incident: {
      number: SIM_REPAIR_NUMBER,
      title: `Fixie: reparar ${n} hallazgos`,
      url: "https://github.com/autosana/devshop/issues/43",
      createdAt: new Date(startedAt).toISOString(),
      payload: null,
      repair: sim.info,
      steps,
      stage: deriveStage(steps),
      round: currentRound(steps),
      occurrences: 1,
      pr: prStep?.data.pr ?? null,
      mergeSha: merged?.data.sha ?? null,
    },
    diff: prStep ? sim.diff : [],
  };
}
