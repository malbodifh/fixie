import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, List, Section } from "../legal";
import { CONTACT_URL } from "../site-footer";

export const metadata: Metadata = {
  title: "Términos",
  description: "Las condiciones para usar Fixie.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Términos" updated="22 de noviembre de 2026">
      <Section title="Qué es Fixie">
        <p>
          Fixie vigila una app web en producción y repara lo que se arregla con código: reproduce cada error con una prueba, escribe el arreglo, un segundo agente intenta
          romperlo y, solo si no puede, lo publica. Fixie está en desarrollo activo; sus funciones pueden cambiar.
        </p>
      </Section>

      <Section title="Tu cuenta y tus repositorios">
        <List
          items={[
            "Entras con tu cuenta de GitHub. Solo conecta repositorios, apps y bases de datos que sean tuyos o que estés autorizado a administrar.",
            "Fixie abre issues y pull requests en tus repositorios. Si dejas activado el merge automático, también hace merge a tu rama principal; puedes desactivarlo en los ajustes de cada proyecto.",
            "Eres responsable de tu código, de tu despliegue y de revisar los cambios que aceptes.",
          ]}
        />
      </Section>

      <Section title="Pentesting">
        <p>
          Las pruebas activas de pentesting solo corren sobre dominios cuya propiedad verificaste. El pentest profundo ataca una copia desechable de tu app dentro de tu propio
          GitHub Actions, nunca tu producción. No uses Fixie para analizar apps de otras personas sin su permiso.
        </p>
      </Section>

      <Section title="Inteligencia artificial">
        <p>
          Los arreglos los escribe un modelo de IA. Fixie los prueba con tus pruebas y con las de un revisor antes de publicarlos, pero ninguna prueba garantiza que un cambio esté
          libre de errores. Los textos que propone Conversión solo se aplican si tú los eliges.
        </p>
      </Section>

      <Section title="Planes y créditos">
        <p>
          El trabajo con IA consume créditos de tu plan, como se explica en la página{" "}
          <Link href="/uso" className="text-accent underline underline-offset-2">
            Uso
          </Link>
          . Cuando se acaban, Fixie pausa el trabajo y lo retoma cuando se renuevan. El pentest profundo se cobra en tu propia cuenta del proveedor de IA, no en tus créditos.
        </p>
      </Section>

      <Section title="Tus datos">
        <p>
          Fixie nunca modifica ni borra los datos de tu base: solo puede agregar estructura, después de un respaldo. Lo que guardamos y con quién lo compartimos está en{" "}
          <Link href="/privacidad" className="text-accent underline underline-offset-2">
            Privacidad
          </Link>
          .
        </p>
      </Section>

      <Section title="Sin garantías">
        <p>
          Fixie se ofrece tal cual. Hacemos lo posible por que funcione bien y por proteger tus datos, pero no garantizamos que el servicio esté siempre disponible ni libre de
          errores, y no respondemos por pérdidas derivadas de su uso.
        </p>
      </Section>

      <Section title="Cambios y contacto">
        <p>
          Si estos términos cambian, actualizaremos esta página y su fecha. Para cualquier duda, escríbenos en{" "}
          <a href={CONTACT_URL} className="text-accent underline underline-offset-2">
            los issues del repositorio de Fixie
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
