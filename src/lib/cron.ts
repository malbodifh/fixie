import "server-only";
import { safeEqual } from "./crypto";
import { env } from "./env";

/** Las rutas internas (cron, motor) solo aceptan el secreto del servidor. */
export function cronAuthorized(req: Request): boolean {
  const secret = env.cronSecret();
  return !!secret && safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

export const unauthorized = () => Response.json({ error: "No autorizado" }, { status: 401 });
