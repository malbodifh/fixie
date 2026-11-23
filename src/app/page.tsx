import { ArrowRight, Bug, Check, DatabaseBackup, FlaskConical, Gauge, GitMerge, Lock, MousePointerClick, Play, ShieldCheck, Undo2 } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/session";
import { Console } from "./console";
import { Mascot } from "./mascot";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { SNIPPET } from "./snippet";

const LOOP = [
  { icon: Bug, title: "Detecta", text: "Tu app falla en producción y Fixie recibe el error con su contexto." },
  { icon: FlaskConical, title: "Reproduce", text: "Escribe una prueba que falla en CI. Si no la reproduce, no toca nada." },
  { icon: ShieldCheck, title: "Arregla y se ataca", text: "Escribe el arreglo y un revisor intenta romperlo otra vez, hasta 3 rondas." },
  { icon: GitMerge, title: "Publica y verifica", text: "Solo entonces hace merge a main y confirma que producción ya está bien." },
];

const GUARANTEES = [
  { icon: Lock, title: "Solo lectura para tus datos", text: "Las consultas corren en transacciones de solo lectura. Postgres rechaza cualquier DELETE, UPDATE o INSERT." },
  { icon: ShieldCheck, title: "Estructura, nunca datos", text: "Solo puede agregar tablas, columnas o índices. DROP, TRUNCATE o cambiar tipos se bloquea antes de llegar a tu base." },
  { icon: DatabaseBackup, title: "Respaldo antes de tocar", text: "Antes de cualquier cambio, y cada semana, guarda una copia de estructura y datos." },
  { icon: Undo2, title: "Ensayado y deshecho", text: "Cada cambio se prueba primero dentro de una transacción que se revierte. Si falla, no pasa nada." },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-[1200px] items-center gap-12 px-4 pb-20 pt-16 md:px-6 md:pt-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="flex flex-col items-start">
            <h1 className="max-w-[14ch] text-balance text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[60px]">
              Tu app falla. Fixie la arregla y lo demuestra.
            </h1>
            <p className="mt-5 max-w-[52ch] text-pretty text-[17px] leading-relaxed text-fg-2">
              Reproduce el error en un entorno de pruebas y escribe el arreglo. Después, un revisor intenta romperlo otra vez. Solo cuando ya no puede, el arreglo llega a producción.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Suspense fallback={<span className="skeleton h-11 w-48" aria-hidden />}>
                <PrimaryCta />
              </Suspense>
              <a href="#demo" className="btn btn-outline btn-lg">
                <Play />
                Ver una demo
              </a>
            </div>
            <p className="mt-6 text-[13px] text-fg-3">Para apps de Next.js. Tus datos nunca se modifican.</p>
          </div>
          <HeroWindow />
        </section>

        {/* El ciclo */}
        <section className="border-y border-line bg-surface-2/60">
          <div className="mx-auto w-full max-w-[1200px] px-4 py-20 md:px-6">
            <h2 className="max-w-[24ch] text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">Ningún arreglo llega a producción sin que alguien intente romperlo.</h2>
            <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {LOOP.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex flex-col gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface text-accent shadow-card">
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </span>
                  <p className="text-[15px] font-semibold">{title}</p>
                  <p className="text-[14px] leading-relaxed text-fg-2">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Cuatro revisiones */}
        <section className="mx-auto w-full max-w-[1200px] px-4 py-20 md:px-6">
          <h2 className="max-w-[22ch] text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">Cuatro revisiones. Fixie repara lo que encuentra.</h2>
          <p className="mt-3 max-w-[60ch] text-[16px] text-fg-2">Errores en vivo, seguridad, conversión y rendimiento. Cada hallazgo se reproduce con una prueba, se repara con un PR y se vuelve a analizar en producción.</p>
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2">
            <Feature icon={Bug} title="Errores" text="Fallos en producción que Fixie reproduce, arregla y verifica.">
              <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px]">
                <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
                <span className="truncate font-mono text-[12px]">TypeError: reading &apos;percent&apos;</span>
                <span className="ml-auto shrink-0 text-ok">Arreglado en 1:02</span>
              </div>
            </Feature>
            <Feature icon={ShieldCheck} title="Pentesting" text="Cabeceras, cookies y CORS. En los planes de pago, tus dependencias vigiladas 24/7: si sale una vulnerabilidad, Fixie actualiza.">
              <FindingRow sev="Alto" tone="bad" text="Sin Content-Security-Policy" />
            </Feature>
            <Feature icon={MousePointerClick} title="Conversión" text="Lo que hace que un visitante compre, se registre o te escriba.">
              <FindingRow sev="Medio" tone="warn" text="Campos del checkout sin etiqueta" />
            </Feature>
            <Feature icon={Gauge} title="Lighthouse" text="La auditoría de Google en móvil y escritorio: rendimiento, accesibilidad, buenas prácticas y SEO.">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-line bg-surface px-3 py-2.5 sm:grid-cols-4 sm:gap-3">
                {[
                  ["Rend.", 92],
                  ["Acces.", 100],
                  ["Prácticas", 96],
                  ["SEO", 90],
                ].map(([k, v]) => (
                  <div key={k} className="flex min-w-0 flex-col gap-1.5">
                    <span className="flex items-baseline justify-between gap-1 text-[11px] text-fg-3">
                      <span className="truncate">{k}</span>
                      <span className="text-[12px] font-medium text-ok tabular">{v}</span>
                    </span>
                    <span className="meter text-ok">
                      <span style={{ width: `${v}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            </Feature>
          </div>
          <p className="mt-3 text-[12px] text-fg-3">Datos de ejemplo.</p>
        </section>

        {/* Demo */}
        <section id="demo" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto w-full max-w-[1200px] px-4 py-20 md:px-6">
            <h2 className="text-3xl font-semibold tracking-[-0.025em] md:text-4xl">Míralo arreglar un error.</h2>
            <p className="mt-3 max-w-[60ch] text-[16px] text-fg-2">Una simulación del ciclo completo, con las mismas pantallas que verás en tu proyecto.</p>
            <div className="mt-10">
              <Console settled />
            </div>
          </div>
        </section>

        {/* Base de datos */}
        <section className="border-t border-line bg-surface-2/60">
          <div className="mx-auto grid w-full max-w-[1200px] gap-12 px-4 py-20 md:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <h2 className="max-w-[16ch] text-balance text-3xl font-semibold tracking-[-0.025em] md:text-4xl">Tu base de datos queda intacta.</h2>
              <p className="mt-3 max-w-[44ch] text-[16px] text-fg-2">Fixie puede leer para diagnosticar y agregar estructura cuando un arreglo lo necesita. Nunca borra ni cambia tus datos.</p>
            </div>
            <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
              {GUARANTEES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-3">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" strokeWidth={1.75} />
                  <div>
                    <p className="text-[15px] font-semibold">{title}</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-fg-2">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Para quién */}
        <section className="mx-auto w-full max-w-[1200px] px-4 py-20 md:px-6">
          <h2 className="text-3xl font-semibold tracking-[-0.025em] md:text-4xl">Hecho para quien publica rápido.</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <Audience
              title="Si construyes con IA"
              text="Publicas con v0, Lovable, Bolt o Cursor, pero depurar producción no es lo tuyo. Fixie es el ingeniero de guardia que no tienes."
              points={["Arreglos probados antes de publicarse", "Seguridad básica que suele faltar", "Tu primera app, sin miedo a romperla"]}
            />
            <Audience
              title="Si mantienes sitios de clientes"
              text="Agencias y freelancers con muchos proyectos. Menos horas apagando incendios y resultados claros para mostrar a cada cliente."
              points={["Todos tus proyectos en un panel", "Seguridad, conversión y rendimiento reparados solos", "Arreglos con PR revisable"]}
            />
          </div>
        </section>

        {/* Instalación */}
        <section className="border-t border-line">
          <div className="mx-auto grid w-full max-w-[1200px] gap-12 px-4 py-20 md:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div className="flex flex-col items-start">
              <h2 className="text-3xl font-semibold tracking-[-0.025em] md:text-4xl">Conéctala en dos minutos.</h2>
              <ol className="mt-6 flex flex-col gap-4 text-[15px]">
                {["Entra con GitHub y crea un proyecto con tu repo.", "Pega este archivo en tu app de Next.js.", "Agrega la URL y la clave del proyecto a tus variables."].map((step, i) => (
                  <li key={step} className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-2 text-[12px] font-medium text-fg-2 tabular">{i + 1}</span>
                    <span className="text-fg-2">{step}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-8">
                <Suspense fallback={<span className="skeleton h-11 w-48" aria-hidden />}>
                  <PrimaryCta />
                </Suspense>
              </div>
            </div>
            <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              <p className="border-b border-line px-4 py-2.5 font-mono text-[12px] text-fg-3">src/instrumentation.ts</p>
              <pre className="overflow-auto p-4 font-mono text-[12px] leading-relaxed text-fg-2">{SNIPPET.replace(/^\/\/ src\/instrumentation\.ts\n/, "")}</pre>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function HeroWindow() {
  const steps = [
    ["Error recibido", "POST /api/checkout"],
    ["Reproducido en CI", "La prueba falla como en producción"],
    ["Arreglo escrito", "src/lib/coupons.ts"],
    ["El revisor intentó romperlo", "3 pruebas nuevas, todas pasan"],
    ["Publicado y verificado", "main · commit a1b2c3d"],
  ];
  return (
    <div className="relative">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-float">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
          </span>
          <span className="ml-2 text-[12px] text-fg-3">DevShop · Incidente #12</span>
          <span className="badge ml-auto bg-ok-bg text-ok">
            <Check strokeWidth={2.5} />
            Arreglado en 1:02
          </span>
        </div>
        <div className="flex flex-col gap-5 p-5 md:p-6">
          <p className="font-mono text-[13px] leading-snug text-bad">TypeError: Cannot read properties of undefined (reading &apos;percent&apos;)</p>
          <ol className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-line">
            {steps.map(([title, detail], i) => (
              <li key={title} className="step-in relative flex gap-3" style={{ animationDelay: `${i * 90}ms` }}>
                <span className="relative grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full bg-accent-solid text-accent-fg">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <div className="-mt-0.5 min-w-0">
                  <p className="text-[14px] font-medium">{title}</p>
                  <p className="truncate text-[13px] text-fg-3">{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="absolute -bottom-7 left-4 rounded-2xl border border-line bg-surface p-2 shadow-float md:-left-8">
        <Mascot mode="loop" size={88} />
      </div>
      <p className="mt-10 text-right text-[12px] text-fg-3">Ejemplo con la tienda de demostración.</p>
    </div>
  );
}

function Feature({ icon: Icon, title, text, children }: { icon: typeof Bug; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-5 bg-surface p-6 md:p-8">
      <div>
        <p className="flex items-center gap-2 text-[16px] font-semibold">
          <Icon className="h-[18px] w-[18px] text-accent" strokeWidth={1.75} />
          {title}
        </p>
        <p className="mt-1.5 text-[14px] text-fg-2">{text}</p>
      </div>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

function FindingRow({ sev, tone, text }: { sev: string; tone: "bad" | "warn"; text: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px]">
      <span className={`badge ${tone === "bad" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}>{sev}</span>
      <span className="truncate">{text}</span>
      <span className="ml-auto shrink-0 text-accent">Fixie lo repara</span>
    </div>
  );
}

function Audience({ title, text, points }: { title: string; text: string; points: string[] }) {
  return (
    <div className="card flex flex-col gap-4 p-6 md:p-8">
      <p className="text-xl font-semibold tracking-tight">{title}</p>
      <p className="text-[15px] leading-relaxed text-fg-2">{text}</p>
      <ul className="mt-1 flex flex-col gap-2.5">
        {points.map((p) => (
          <li key={p} className="flex items-center gap-2.5 text-[14px]">
            <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

async function PrimaryCta() {
  const user = await getCurrentUser();
  return user ? (
    <Link href="/proyectos" className="btn btn-primary btn-lg">
      Ir a mis proyectos
      <ArrowRight />
    </Link>
  ) : (
    <a href="/api/auth/login" className="btn btn-primary btn-lg">
      Entrar con GitHub
      <ArrowRight />
    </a>
  );
}
