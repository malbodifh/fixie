import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// CSP sin nonce (la que documenta Next.js para páginas estáticas y Partial Prerendering):
// Next.js mete scripts inline, por eso 'unsafe-inline' en script-src.
// Imágenes externas: solo los avatares de GitHub.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://avatars.githubusercontent.com",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://github.com",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // El micrófono solo para el dictado del asistente, en el propio sitio.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // Sin el indicador de Next en desarrollo: tapa contenido en la demo y en las capturas.
  devIndicators: false,
  // No anunciar la tecnología del servidor (X-Powered-By).
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
