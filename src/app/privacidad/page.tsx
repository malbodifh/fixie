import type { Metadata } from "next";
import { LegalPage, List, Section } from "../legal";
import { CONTACT_URL } from "../site-footer";

export const metadata: Metadata = {
  title: "Privacidad",
  description: "Qué datos guarda Fixie, para qué los usa y con quién los comparte.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacidad" updated="22 de noviembre de 2026">
      <Section title="En resumen">
        <p>
          Fixie guarda lo mínimo para mantener sana tu app: tu cuenta de GitHub, los proyectos que conectas y el resultado de sus análisis. Los tokens y las conexiones a bases de
          datos se guardan cifrados. Tus datos nunca se venden ni se usan para publicidad.
        </p>
      </Section>

      <Section title="Qué guardamos">
        <List
          items={[
            "De tu cuenta de GitHub: identificador, usuario, nombre y foto de perfil.",
            "Tu token de acceso a GitHub, cifrado (AES-256-GCM). Con él Fixie lee tus repositorios, abre issues y pull requests y, si lo permites, hace merge.",
            "De cada proyecto: el repositorio, la URL de producción y, si la conectas, la conexión a tu base de datos, cifrada.",
            "Los resultados de los análisis (errores, pentesting, conversión, Lighthouse y dependencias).",
            "El consumo de IA: qué trabajo se hizo, cuántos tokens usó y su costo, para medir los créditos de tu plan.",
            "Si conectas tu propia IA por MCP, solo el hash de tu token personal, nunca el token.",
          ]}
        />
        <p>
          Los incidentes y las reparaciones viven como issues y pull requests en tu propio repositorio de GitHub. Los errores que reporta tu app llegan a esos issues; Fixie no
          guarda una copia aparte.
        </p>
      </Section>

      <Section title="Tu base de datos">
        <p>
          Si conectas una base de datos, Fixie solo la lee y, como máximo, le agrega estructura (tablas, columnas o índices), nunca modifica ni borra datos. Antes de cualquier
          cambio, y cada semana, guarda un respaldo con estructura y datos en un almacenamiento privado al que solo accede el servidor de Fixie. Puedes descargar esos respaldos
          desde el proyecto.
        </p>
        <p>
          Para el pentest profundo, Fixie copia solo la estructura de tu base, sin ninguna fila, a una base desechable dentro de tu propio GitHub Actions. La clave del modelo
          que usa ese pentest se guarda únicamente como secreto cifrado de tu repositorio.
        </p>
      </Section>

      <Section title="Con quién se comparte">
        <List
          items={[
            "Supabase: aloja la base de datos y los respaldos de Fixie.",
            "Vercel: aloja la aplicación.",
            "DeepSeek: el modelo de IA. Recibe lo necesario para cada tarea: el error, el código relevante de tu repositorio, los cambios del día, los textos de tu página o tus mensajes al asistente.",
            "GitHub: donde Fixie trabaja sobre tu repositorio.",
            "Google PageSpeed Insights: recibe la URL pública de tu app para medir Lighthouse.",
            "OSV.dev y CISA: Fixie consulta sus catálogos de vulnerabilidades con los nombres y versiones de tus dependencias.",
          ]}
        />
      </Section>

      <Section title="Cookies">
        <p>
          Fixie usa una sola cookie propia para mantener tu sesión, y otra temporal durante el inicio de sesión con GitHub. No usa cookies de publicidad ni de analítica de
          terceros. Al cerrar sesión, todas las sesiones abiertas de tu cuenta dejan de valer.
        </p>
      </Section>

      <Section title="Tus derechos">
        <p>
          Puedes desconectar una base de datos o revocar tu token de MCP en cualquier momento desde Fixie, y revocar el acceso de Fixie a GitHub desde la configuración de tu
          cuenta de GitHub. Para pedir una copia de tus datos o que se borren, escríbenos en{" "}
          <a href={CONTACT_URL} className="text-accent underline underline-offset-2">
            los issues del repositorio de Fixie
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
