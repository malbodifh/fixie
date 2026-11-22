import "server-only";
import { z } from "zod";
import { askStructured } from "../agent/ask";
import { hasModelKey } from "../agent/model";
import { fetchApp, scoreOf, summaryOf, type Finding, type ScanResult } from "./common";

/**
 * Conversión: lo que hace que un visitante compre, se registre o te contacte.
 * Revisa la página principal y los enlaces que salen de ella. Solo GET.
 * (El SEO lo cubre Lighthouse.)
 */

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

function textOf(html: string): string {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function attr(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`, "i"))?.[1] ?? null;
}

function meta(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = attr(tag, "name") ?? attr(tag, "property");
    if (k?.toLowerCase() === key) return decode(attr(tag, "content") ?? "");
  }
  return null;
}

/** Verbos de una acción principal: comprar, registrarse, empezar, contactar… */
const ACTION =
  /\b(compr|agreg|añad|anad|pag|reserv|registr|suscrib|empez|comenz|prueb|descarg|contact|cotiz|solicit|únete|unete|crear cuenta|entrar|buy|add to cart|checkout|get started|sign ?up|subscribe|book|contact|try|download|start)/i;

const NEXT_METADATA = "En Next.js, defínelo en `export const metadata` del layout.";

export async function runConversion(appUrl: string): Promise<ScanResult> {
  const origin = new URL(appUrl).origin;
  const res = await fetchApp(appUrl);
  const html = await res.text();
  const f: Finding[] = [];
  const add = (x: Finding) => f.push(x);

  // ── La página carga y se ve bien en el móvil ──
  add({
    id: "status",
    title: "La página principal carga",
    severity: "critico",
    passed: res.ok,
    detail: res.ok ? `Respondió ${res.status}.` : `Respondió ${res.status}: cada visita es una venta perdida.`,
    fix: "Revisa el error del servidor en esta ruta; Fixie lo trata como un incidente.",
  });
  const viewport = meta(html, "viewport");
  add({
    id: "viewport",
    title: "Se adapta al móvil",
    severity: "alto",
    passed: !!viewport && /width=device-width/i.test(viewport),
    detail: viewport ? `viewport: ${viewport}` : "Sin meta viewport: en el móvil la página se ve diminuta y la gente se va.",
    fix: "Next.js lo agrega solo; exporta `viewport` en el layout si lo quitaste.",
  });

  // ── Propuesta de valor y acción principal ──
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => textOf(m[1]));
  const headline = h1s[0] ?? "";
  add({
    id: "headline",
    title: "Titular que explica qué ofreces",
    severity: "medio",
    passed: h1s.length === 1 && headline.split(" ").length >= 3,
    detail: h1s.length === 0 ? "No hay un titular principal (<h1>)." : h1s.length > 1 ? `Hay ${h1s.length} titulares <h1>: compiten por la atención.` : `"${headline.slice(0, 90)}" (${headline.split(" ").length} palabras).`,
    fix: "Un solo <h1> que diga en una frase qué ofreces y para quién.",
  });

  const controls = [...html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map((m) => ({ tag: m[1].toLowerCase(), attrs: m[2], text: textOf(m[3]) }));
  const ctas = controls.filter((c) => ACTION.test(c.text) || ACTION.test(attr(`<x ${c.attrs}>`, "aria-label") ?? ""));
  add({
    id: "cta",
    title: "Acción principal clara",
    severity: "alto",
    passed: ctas.length > 0,
    detail: ctas.length ? `Botones de acción: ${[...new Set(ctas.map((c) => `"${c.text.slice(0, 30)}"`))].slice(0, 4).join(", ")}.` : "No encontré un botón con una acción clara (comprar, registrarse, empezar, contactar…).",
    fix: "Agrega un botón visible con un verbo concreto: \"Agregar al carrito\", \"Empezar gratis\", \"Reservar\".",
  });

  // ── Formularios sin fricción ──
  const inputs = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)]
    .map((m) => ({ tag: m[1].toLowerCase(), raw: m[0] }))
    .filter((i) => !/type=["'](hidden|submit|button|image|reset|checkbox|radio)["']/i.test(i.raw));
  const labelFor = new Set([...html.matchAll(/<label\b[^>]*\sfor=["']([^"']+)["']/gi)].map((m) => m[1]));
  const unlabeled = inputs.filter((i) => {
    const id = attr(i.raw, "id");
    return !(attr(i.raw, "aria-label") || attr(i.raw, "aria-labelledby") || (id && labelFor.has(id)));
  });
  // Un input dentro de <label>…</label> también cuenta como etiquetado.
  const wrapped = (html.match(/<label\b[^>]*>[\s\S]*?<\/label>/gi) ?? []).join(" ");
  const reallyUnlabeled = unlabeled.filter((i) => !wrapped.includes(i.raw));
  if (inputs.length) {
    add({
      id: "form-labels",
      title: "Campos de formulario con etiqueta",
      severity: "medio",
      passed: reallyUnlabeled.length === 0,
      detail: reallyUnlabeled.length ? `${reallyUnlabeled.length} de ${inputs.length} campos sin etiqueta: el placeholder desaparece al escribir y la gente se pierde.` : `${inputs.length} campos, todos con etiqueta.`,
      fix: "Agrega un <label> visible (o aria-label) a cada campo.",
    });
    const wrongType = inputs.filter((i) => {
      const hint = `${attr(i.raw, "name") ?? ""} ${attr(i.raw, "id") ?? ""} ${attr(i.raw, "placeholder") ?? ""}`.toLowerCase();
      const type = (attr(i.raw, "type") ?? "text").toLowerCase();
      if (/(e-?mail|correo)/.test(hint)) return type !== "email" || !attr(i.raw, "autocomplete");
      if (/(tel|phone|telefono|teléfono|celular|whatsapp)/.test(hint)) return type !== "tel" || !attr(i.raw, "autocomplete");
      return false;
    });
    add({
      id: "input-types",
      title: "Teclado y autocompletado correctos",
      severity: "bajo",
      passed: wrongType.length === 0,
      detail: wrongType.length ? `${wrongType.length} campos de correo o teléfono sin type o autocomplete: en el móvil sale el teclado equivocado.` : "Correo y teléfono usan el tipo y el autocompletado correctos.",
      fix: "Usa `type=\"email\" autocomplete=\"email\"` y `type=\"tel\" autocomplete=\"tel\"`.",
    });
    const forms = (html.match(/<form\b[\s\S]*?<\/form>/gi) ?? []).map((form) => (form.match(/<(input|select|textarea)\b/gi) ?? []).length);
    const longest = Math.max(0, ...forms);
    add({
      id: "form-length",
      title: "Formularios cortos",
      severity: "bajo",
      passed: longest <= 6,
      detail: longest > 6 ? `Un formulario pide ${longest} campos: cada campo extra baja la conversión.` : "Ningún formulario pide más de 6 campos.",
      fix: "Pide solo lo indispensable; lo demás, después de la conversión.",
    });
  }

  // ── Enlaces e imágenes rotos ──
  const hrefs = [
    ...new Set(
      [...html.matchAll(/<a\b[^>]*\shref=["']([^"'#]+)["']/gi)]
        .map((m) => m[1])
        .filter((h) => !/^(mailto|tel|javascript):/i.test(h))
        .map((h) => {
          try {
            return new URL(h, origin).href;
          } catch {
            return null;
          }
        })
        .filter((h): h is string => !!h && h.startsWith(origin)),
    ),
  ].slice(0, 15);
  const linkChecks = await Promise.all(hrefs.map(async (h) => ({ h, status: (await fetchApp(h, { method: "GET" }, 8000).catch(() => null))?.status ?? 0 })));
  const broken = linkChecks.filter((l) => l.status === 0 || l.status >= 400);
  add({
    id: "broken-links",
    title: "Sin enlaces rotos",
    severity: "alto",
    passed: broken.length === 0,
    detail: broken.length ? `Rotos: ${broken.map((b) => `${new URL(b.h).pathname} (${b.status || "sin respuesta"})`).join(", ")}.` : `${hrefs.length} enlaces internos revisados, todos responden.`,
    fix: "Corrige o quita los enlaces que llevan a páginas que no existen o fallan.",
  });

  const srcs = [
    ...new Set(
      [...html.matchAll(/<img\b[^>]*\ssrc=["']([^"']+)["']/gi)]
        .map((m) => m[1])
        .filter((s) => !s.startsWith("data:"))
        .map((s) => {
          try {
            return new URL(s.replace(/&amp;/g, "&"), origin).href;
          } catch {
            return null;
          }
        })
        .filter((s): s is string => !!s),
    ),
  ].slice(0, 15);
  if (srcs.length) {
    const imgChecks = await Promise.all(srcs.map(async (s) => ({ s, ok: !!(await fetchApp(s, {}, 8000).catch(() => null))?.ok })));
    const brokenImgs = imgChecks.filter((i) => !i.ok);
    add({
      id: "broken-images",
      title: "Sin imágenes rotas",
      severity: "medio",
      passed: brokenImgs.length === 0,
      detail: brokenImgs.length ? `${brokenImgs.length} de ${srcs.length} imágenes no cargan.` : `${srcs.length} imágenes cargan bien.`,
      fix: "Corrige la ruta de las imágenes o súbelas a public/.",
    });
  }

  // ── Confianza ──
  const text = textOf(html).toLowerCase();
  const trust = ["privacidad", "privacy", "términos", "terminos", "terms", "contacto", "contact", "devoluc", "envío", "envio", "garantía", "garantia"].filter((w) => text.includes(w));
  add({
    id: "trust",
    title: "Señales de confianza",
    severity: "bajo",
    passed: trust.length >= 2,
    detail: trust.length ? `Encontré: ${trust.slice(0, 4).join(", ")}.` : "No hay contacto, privacidad, términos ni política de devoluciones a la vista.",
    fix: "Agrega en el pie enlaces a contacto, privacidad y términos (y devoluciones si vendes).",
  });

  // ── Al compartir el enlace ──
  const og = ["og:title", "og:description", "og:image"].filter((k) => !meta(html, k));
  add({
    id: "social-preview",
    title: "Vista previa al compartir",
    severity: "bajo",
    passed: og.length === 0,
    detail: og.length ? `Falta: ${og.join(", ")}. En WhatsApp o redes tu enlace sale sin imagen ni descripción.` : "Título, descripción e imagen definidos.",
    fix: `Agrega \`openGraph\` a metadata o un archivo opengraph-image.png. ${NEXT_METADATA}`,
  });

  // ── Velocidad percibida ──
  const head = html.match(/<head\b[\s\S]*?<\/head>/i)?.[0] ?? "";
  const blocking = (head.match(/<script\b[^>]*\ssrc=[^>]*>/gi) ?? []).filter((t) => !/\s(async|defer|nomodule)\b|type=["']module["']/i.test(t));
  add({
    id: "blocking-scripts",
    title: "Sin scripts que bloqueen la carga",
    severity: "medio",
    passed: blocking.length === 0,
    detail: blocking.length ? `${blocking.length} scripts en <head> sin async ni defer: la página tarda en aparecer.` : "Los scripts no bloquean el primer pintado.",
    fix: "Carga los scripts de terceros con `next/script` y `strategy=\"lazyOnload\"`, o agrega defer.",
  });
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  add({
    id: "html-weight",
    title: "Página liviana",
    severity: "bajo",
    passed: kb <= 400,
    detail: `El HTML pesa ${kb} KB${kb > 400 ? ": tarda en móviles con mala señal." : "."}`,
    fix: "Pagina o carga bajo demanda las listas largas; no incrustes datos enormes en la página.",
  });

  // ── Textos: sugerencias que el usuario elige aplicar o no ──
  const copy = extractCopy(html);
  const suggestions = hasModelKey() ? await copySuggestions(copy).catch(() => []) : [];
  f.push(...suggestions);

  const technical = f.filter((x) => !x.copy);
  return {
    status: "ok",
    score: scoreOf(technical),
    summary: [summaryOf(technical), suggestions.length ? `${suggestions.length} textos para mejorar` : null].filter(Boolean).join(" · "),
    findings: f,
    meta: { headline, ctas: ctas.length, links: hrefs.length },
  };
}

/**
 * Los textos visibles que deciden la conversión, en pocas líneas: lo único que
 * se manda al modelo (no el HTML), para gastar pocos tokens.
 */
export function extractCopy(html: string): { role: string; text: string }[] {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const out: { role: string; text: string }[] = [];
  const count = (role: string) => out.filter((o) => o.role === role).length;
  const push = (role: string, raw: string, minWords = 1) => {
    const text = textOf(raw);
    if (text && text.split(" ").length >= minWords && text.length <= 300 && !out.some((o) => o.text === text)) out.push({ role, text });
  };
  const title = body.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  if (title) push("título de la pestaña", title);
  const description = meta(body, "description");
  if (description) push("descripción en buscadores", description);
  for (const m of [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].slice(0, 2)) push("titular", m[1]);
  for (const m of [...body.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].slice(0, 8)) push("subtítulo", m[1]);
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) if (count("párrafo") < 5) push("párrafo", m[1], 6);
  for (const m of body.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/(a|button)>/gi)) {
    if (ACTION.test(textOf(m[2])) && count("botón") < 8) push("botón", m[2]);
  }
  for (const m of [...body.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)].slice(0, 6)) push("etiqueta de formulario", m[1]);
  return out;
}

// Principios condensados de coreyhaines31/marketingskills (MIT): page-cro y copywriting.
const COPY_RULES = `Eres Fixie y mejoras los textos de una página para que convierta más. Principios:
- Claridad antes que ingenio: en 5 segundos el visitante entiende qué es, para quién y por qué le conviene.
- Beneficios y resultados, no características. Específico y concreto (números, plazos, qué obtiene).
- El lenguaje del cliente, no jerga interna. Frases cortas, voz activa.
- Botones: verbo + lo que obtiene ("Empieza gratis", "Ver mi pedido"), nunca "Enviar" o "Click aquí".
- Una acción principal clara; responde la objeción principal cerca del botón.
Reglas:
- "actual" debe ser COPIADO LITERAL de la lista (mismo texto exacto).
- Solo propone cambios con impacto claro en la conversión; si un texto ya es bueno, no lo toques.
- Mismo idioma de la página. Sin emojis. Longitud parecida al original.
- No inventes datos (precios, cifras, testimonios, garantías) que la página no tenga.`;

async function copySuggestions(copy: { role: string; text: string }[]): Promise<Finding[]> {
  if (copy.length === 0) return [];
  const out = await askStructured({
    name: "sugerir_textos",
    description: "Propón los cambios de texto con más impacto en la conversión (máximo 6).",
    schema: z.object({
      cambios: z
        .array(
          z.object({
            actual: z.string(),
            propuesto: z.string().max(300),
            porque: z.string().max(240).describe("Por qué convierte mejor, en una frase"),
            impacto: z.enum(["alto", "medio", "bajo"]),
          }),
        )
        .max(6),
    }),
    instructions: COPY_RULES,
    prompt: copy.map((c) => `[${c.role}] ${c.text}`).join("\n"),
    fast: true,
    maxOutputTokens: 2000,
  });
  const known = new Map(copy.map((c) => [c.text, c.role]));
  return (out?.cambios ?? [])
    .filter((c) => known.has(c.actual) && c.propuesto.trim() && c.propuesto.trim() !== c.actual)
    .map((c) => {
      const role = known.get(c.actual)!;
      return {
        id: `copy:${c.actual.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, "-").slice(0, 48)}`,
        title: role[0].toUpperCase() + role.slice(1),
        severity: c.impacto === "alto" ? ("medio" as const) : ("bajo" as const),
        passed: false,
        detail: c.porque,
        fix: `Cambiar "${c.actual}" por "${c.propuesto.trim()}".`,
        copy: { from: c.actual, to: c.propuesto.trim() },
      };
    });
}
