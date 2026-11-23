import Link from "next/link";
import { FixieLogo } from "./logo";

/** Pie de las páginas públicas: privacidad, términos y contacto. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 text-[13px] text-fg-3 md:px-6">
        <span className="flex items-center gap-2">
          <FixieLogo size={16} />
          Fixie
        </span>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacidad" className="hover:text-fg">
            Privacidad
          </Link>
          <Link href="/terminos" className="hover:text-fg">
            Términos
          </Link>
          <a href={CONTACT_URL} className="hover:text-fg">
            Contacto
          </a>
        </nav>
      </div>
    </footer>
  );
}

/** Contacto público: los issues del repositorio de Fixie. */
export const CONTACT_URL = "https://github.com/malbodifh/fixie/issues";
