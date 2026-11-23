import { ImageResponse } from "next/og";

// Vista previa al compartir el enlace (WhatsApp, redes): el logo y la promesa, sobre negro.
export const alt = "Fixie: tu app falla, Fixie la arregla y lo demuestra.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#0a0a0b", color: "#fafafa" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width={72} height={72} viewBox="0 0 231 232" fill="#fafafa">
            <rect x="15" y="15" width="201" height="118" rx="43" fill="none" stroke="#fafafa" strokeWidth="30" />
            <rect x="58" y="164" width="44" height="68" rx="13" />
            <rect x="130" y="164" width="44" height="68" rx="13" />
          </svg>
          <span style={{ fontSize: 56, fontWeight: 600, letterSpacing: -1 }}>Fixie</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <span style={{ fontSize: 72, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>Tu app falla. Fixie la arregla y lo demuestra.</span>
          <span style={{ fontSize: 32, color: "#a1a1aa" }}>Reproduce el error, escribe el arreglo y lo prueba antes de publicarlo.</span>
        </div>
        <div style={{ display: "flex", width: 120, height: 8, borderRadius: 4, background: "#0a66f0" }} />
      </div>
    ),
    size,
  );
}
