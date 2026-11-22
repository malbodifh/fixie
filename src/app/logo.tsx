/**
 * Logo de Fixie: la cabeza (pantalla redondeada) y dos piernas.
 * Toma el color del texto, así funciona igual en tema claro y oscuro.
 * La mascota animada sigue en ./mascot.tsx; esto es solo la marca.
 */
export function FixieLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 231 232"
      fill="currentColor"
      className={className}
      aria-hidden
      focusable="false"
    >
      <rect x="15" y="15" width="201" height="118" rx="43" fill="none" stroke="currentColor" strokeWidth="30" />
      <rect x="58" y="164" width="44" height="68" rx="13" />
      <rect x="130" y="164" width="44" height="68" rx="13" />
    </svg>
  );
}
