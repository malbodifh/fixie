import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const description = "Fixie reproduce los errores de tu app en producción, los arregla y prueba el arreglo antes de publicarlo.";

// La misma URL pública que usa el servidor (env.baseUrl), aquí sin el módulo server-only.
const publicUrl = process.env.AUTOSANA_BASE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(publicUrl),
  title: { default: "Fixie", template: "%s · Fixie" },
  description,
  // Vista previa al compartir; la imagen la genera opengraph-image.tsx.
  openGraph: { title: "Fixie", description, siteName: "Fixie", locale: "es_MX", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geist.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
