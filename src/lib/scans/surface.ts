import "server-only";
import { connect, type PeerCertificate } from "node:tls";
import { fetchApp, type Finding } from "./common";

/**
 * Superficie del servidor, con los tres módulos de Vertex-Scan como guía
 * (cabeceras en pentest.ts, TLS y rutas expuestas aquí). Implementación propia:
 * ese repo no publica licencia.
 */

/** Certificado y protocolo TLS. Una sola conexión, sin enviar datos. */
export async function tlsFindings(hostname: string): Promise<Finding[]> {
  const info = await new Promise<{ cert: PeerCertificate; protocol: string | null; authorized: boolean; error: string | null } | null>((resolve) => {
    const socket = connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: false, timeout: 8000 }, () => {
      resolve({ cert: socket.getPeerCertificate(), protocol: socket.getProtocol(), authorized: socket.authorized, error: socket.authorizationError ? String(socket.authorizationError) : null });
      socket.end();
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
  if (!info?.cert?.valid_to) return [];

  const f: Finding[] = [];
  const days = Math.floor((Date.parse(info.cert.valid_to) - Date.now()) / 86_400_000);
  f.push({
    id: "tls-valid",
    title: "Certificado TLS válido",
    severity: "critico",
    passed: info.authorized,
    detail: info.authorized ? `Emitido por ${info.cert.issuer?.O ?? info.cert.issuer?.CN ?? "una autoridad reconocida"}.` : `El navegador lo rechaza: ${info.error ?? "certificado no confiable"}.`,
    fix: "Usa el certificado automático de tu hosting (Vercel lo emite y renueva gratis).",
    manual: true,
  });
  f.push({
    id: "tls-expiry",
    title: "El certificado no está por vencer",
    severity: days < 7 ? "critico" : "medio",
    passed: days >= 21,
    detail: days < 0 ? `Venció hace ${-days} días.` : `Vence en ${days} días (${info.cert.valid_to}).`,
    fix: "Activa la renovación automática del certificado en tu hosting.",
    manual: true,
  });
  const old = info.protocol === "TLSv1" || info.protocol === "TLSv1.1";
  f.push({
    id: "tls-protocol",
    title: "Protocolo TLS moderno",
    severity: "alto",
    passed: !old,
    detail: `Negoció ${info.protocol ?? "un protocolo desconocido"}.${old ? " TLS 1.0 y 1.1 tienen ataques conocidos." : ""}`,
    fix: "Exige TLS 1.2 o superior en tu hosting o CDN.",
    manual: true,
  });
  const bits = info.cert.bits;
  if (bits) {
    const rsa = !!info.cert.modulus;
    const weak = rsa ? bits < 2048 : bits < 256;
    f.push({
      id: "tls-key",
      title: "Llave del certificado robusta",
      severity: "medio",
      passed: !weak,
      detail: `${rsa ? "RSA" : "Curva elíptica"} de ${bits} bits.`,
      fix: "Emite el certificado con RSA de 2048 bits o más, o con ECDSA P-256.",
      manual: true,
    });
  }
  return f;
}

/**
 * Rutas que nunca deberían ser públicas. `looks` confirma que la respuesta es el
 * archivo real (y no una página 200 genérica). Nunca se guarda el contenido.
 */
const PATHS: { path: string; looks: RegExp; what: string; severity: Finding["severity"] }[] = [
  { path: ".env", looks: /^[A-Z0-9_]+=/m, what: "Variables de entorno (secretos)", severity: "critico" },
  { path: ".env.local", looks: /^[A-Z0-9_]+=/m, what: "Variables de entorno locales", severity: "critico" },
  { path: ".env.production", looks: /^[A-Z0-9_]+=/m, what: "Variables de entorno de producción", severity: "critico" },
  { path: ".git/HEAD", looks: /^ref: refs\//, what: "Repositorio git", severity: "critico" },
  { path: ".git/config", looks: /\[core\]/, what: "Configuración de git", severity: "critico" },
  { path: ".npmrc", looks: /_authToken|registry=/, what: "Token de npm", severity: "critico" },
  { path: ".aws/credentials", looks: /aws_access_key_id/i, what: "Credenciales de AWS", severity: "critico" },
  { path: ".vscode/sftp.json", looks: /"password"|"host"/, what: "Credenciales de despliegue", severity: "critico" },
  { path: "docker-compose.yml", looks: /services:/, what: "Configuración de contenedores", severity: "alto" },
  { path: "backup.sql", looks: /CREATE TABLE|INSERT INTO/i, what: "Respaldo de la base de datos", severity: "critico" },
  { path: "dump.sql", looks: /CREATE TABLE|INSERT INTO/i, what: "Respaldo de la base de datos", severity: "critico" },
  { path: "db.sqlite", looks: /^SQLite format/, what: "Base de datos SQLite", severity: "critico" },
  { path: "backup.zip", looks: /^PK/, what: "Respaldo comprimido", severity: "alto" },
  { path: ".DS_Store", looks: /Bud1/, what: "Listado de archivos de macOS", severity: "bajo" },
  { path: "phpinfo.php", looks: /phpinfo\(\)|PHP Version/i, what: "Información del servidor PHP", severity: "alto" },
  { path: "server-status", looks: /Apache Server Status/i, what: "Estado interno de Apache", severity: "medio" },
  { path: "api/debug", looks: /"env"|stack|DATABASE_URL/i, what: "Ruta de depuración", severity: "alto" },
  { path: "swagger.json", looks: /"swagger"|"openapi"/, what: "Mapa completo de la API", severity: "bajo" },
];

export async function exposedFindings(origin: string): Promise<Finding[]> {
  const checks = await Promise.all(
    PATHS.map(async ({ path, looks, what, severity }) => {
      const r = await fetchApp(`${origin}/${path}`, { redirect: "manual" }, 8000).catch(() => null);
      const body = r?.ok ? (await r.text().catch(() => "")).slice(0, 2000) : "";
      const exposed = !!r?.ok && looks.test(body);
      return { path, what, severity, exposed, status: r?.status ?? null };
    }),
  );
  const exposed = checks.filter((c) => c.exposed);
  const f: Finding[] = exposed.map((c) => ({
    id: `exposed-${c.path}`,
    title: `/${c.path} es público`,
    severity: c.severity,
    passed: false,
    detail: `${c.what} accesible por cualquiera.`,
    fix: "Quita el archivo del directorio público (o bloquea la ruta) y rota cualquier secreto que haya contenido.",
  }));
  f.push({
    id: "exposed-paths",
    title: `${PATHS.length} rutas sensibles revisadas`,
    severity: "info",
    passed: exposed.length === 0,
    detail: exposed.length ? `${exposed.length} expuestas.` : "Ninguna es pública.",
  });
  return f;
}
