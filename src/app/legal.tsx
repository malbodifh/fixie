import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** Marco de las páginas legales: texto de lectura, ancho cómodo. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <article className="mx-auto w-full max-w-[68ch] px-4 pb-20 pt-14 md:px-6">
          <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em]">{title}</h1>
          <p className="mt-2 text-[13px] text-fg-3">Última actualización: {updated}</p>
          <div className="mt-10 flex flex-col gap-9">{children}</div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 text-[15px] leading-relaxed text-fg-2">
      <h2 className="text-[17px] font-semibold tracking-tight text-fg">{title}</h2>
      {children}
    </section>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-fg-3">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
