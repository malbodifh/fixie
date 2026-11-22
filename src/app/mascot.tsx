// Fixie, la mascota (y el nombre del producto). Dibujo vectorial en tres
// colores de marca: blanco, casi negro y azul, legible en tema claro y oscuro.

export type MascotMode = "loop" | "idle" | "happy" | "sad" | "typing" | "reviewing";

const INK = "#0b0d12";
const WHITE = "#ffffff";
const BLUE = "#2f7bff";
const BLUE_LIGHT = "#7fb2ff";
const STEEL = "#5b6475";

/** Brazo: trazo negro con relleno blanco encima, para que se lea en cualquier fondo. */
function Arm({ d }: { d: string }) {
  return (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={WHITE} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function Hand({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r={4.2} fill={WHITE} stroke={INK} strokeWidth={2.5} />;
}

function RestArms() {
  return (
    <>
      <Arm d="M30 62 Q24 68 26 76" />
      <Arm d="M66 62 Q72 68 70 76" />
    </>
  );
}

function Eyes({ mood }: { mood: "idle" | "happy" | "sad" }) {
  if (mood === "happy") {
    return (
      <g className="fx-eyes" fill="none" stroke={BLUE_LIGHT} strokeWidth={3.2} strokeLinecap="round">
        <path d="M35 37 Q39.5 31 44 37" />
        <path d="M52 37 Q56.5 31 61 37" />
      </g>
    );
  }
  if (mood === "sad") {
    return (
      <g className="fx-eyes" fill={BLUE_LIGHT}>
        <rect x={35.5} y={36} width={8} height={4} rx={2} />
        <rect x={52.5} y={36} width={8} height={4} rx={2} />
      </g>
    );
  }
  return (
    <g className="fx-eyes" fill={BLUE_LIGHT}>
      <rect x={36} y={28.5} width={7.5} height={12} rx={3.75} />
      <rect x={52.5} y={28.5} width={7.5} height={12} rx={3.75} />
      <circle cx={41.3} cy={31.5} r={1.3} fill={WHITE} opacity={0.9} />
      <circle cx={57.8} cy={31.5} r={1.3} fill={WHITE} opacity={0.9} />
    </g>
  );
}

function Lupa() {
  return (
    <g className="fx-p fx-lupa">
      <Arm d="M30 62 Q24 68 26 76" />
      <Arm d="M66 62 Q76 60 78 52" />
      <Hand x={78} y={51} />
      <path d="M80.5 47 L77 43" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      <circle cx={84} cy={40} r={6.5} fill={BLUE} fillOpacity={0.18} stroke={BLUE} strokeWidth={2.8} />
    </g>
  );
}

function Laptop({ className = "fx-p fx-laptop" }: { className?: string }) {
  return (
    <g className={className}>
      <rect x={27} y={61} width={42} height={21} rx={3.5} fill="#1b2130" stroke={STEEL} strokeWidth={1.5} />
      <circle cx={48} cy={71.5} r={2.6} fill={BLUE} />
      <rect x={22} y={81} width={52} height={4.5} rx={2.25} fill={STEEL} />
      <g className="fx-key-a">
        <Arm d="M30 62 Q28 70 33 78" />
        <Arm d="M66 62 Q69 68 64 75" />
        <Hand x={33} y={79} />
        <Hand x={64} y={76} />
      </g>
      <g className="fx-key-b">
        <Arm d="M30 62 Q27 68 32 75" />
        <Arm d="M66 62 Q68 70 63 78" />
        <Hand x={32} y={76} />
        <Hand x={63} y={79} />
      </g>
    </g>
  );
}

function Glasses({ className = "fx-p fx-glasses" }: { className?: string }) {
  const frame = (x: number) => <rect x={x} y={26} width={15} height={16} rx={6} />;
  return (
    <g className={className} fill="none" strokeLinecap="round">
      <g stroke={WHITE} strokeWidth={5}>
        {frame(32)}
        {frame(49)}
        <path d="M47 33 H49" />
      </g>
      <g stroke={INK} strokeWidth={2.6}>
        {frame(32)}
        {frame(49)}
        <path d="M47 33 H49" />
        <path d="M32 31 H22" />
        <path d="M64 31 H74" />
      </g>
    </g>
  );
}

function Paper({ className = "fx-p fx-paper" }: { className?: string }) {
  return (
    <g className={className}>
      <rect x={29} y={57} width={38} height={28} rx={2.5} fill={WHITE} stroke={INK} strokeWidth={2.2} />
      <path d="M35 65 H61 M35 70.5 H57 M35 76 H52" stroke="#c3c8d2" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M35 65 H45" stroke={BLUE} strokeWidth={2.2} strokeLinecap="round" />
      <Arm d="M30 62 Q24 66 28 71" />
      <Arm d="M66 62 Q72 66 68 71" />
      <Hand x={29} y={71} />
      <Hand x={67} y={71} />
    </g>
  );
}

/**
 * loop: la secuencia completa (lupa, la guarda, laptop, la guarda, lentes y hoja).
 * typing / reviewing: solo esa parte (arreglando / revisando un incidente).
 * `still` quita la animación (para filas y listas).
 */
export function Mascot({
  mode = "loop",
  size = 64,
  still = false,
  className = "",
  title = "Fixie",
}: {
  mode?: MascotMode;
  size?: number;
  still?: boolean;
  className?: string;
  title?: string;
}) {
  const mood = mode === "happy" || mode === "sad" ? mode : "idle";
  return (
    <svg
      viewBox="0 0 96 96"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={`fixie fixie-${mode} ${still ? "fixie-still" : ""} block shrink-0 overflow-visible ${className}`}
    >
      <ellipse className="fx-shadow" cx={48} cy={91} rx={22} ry={3} fill="currentColor" opacity={0.12} />
      <g className="fx-body">
        {/* Piernas y cuerpo */}
        <rect x={36} y={76} width={9} height={12} rx={4} fill={WHITE} stroke={INK} strokeWidth={2.5} />
        <rect x={51} y={76} width={9} height={12} rx={4} fill={WHITE} stroke={INK} strokeWidth={2.5} />
        <rect x={29} y={55} width={38} height={27} rx={10} fill={WHITE} stroke={INK} strokeWidth={2.5} />
        <circle cx={48} cy={68} r={3.6} fill={BLUE} />

        {(mode === "idle" || mode === "happy" || mode === "sad") && <RestArms />}
        {mode === "loop" && (
          <g className="fx-p fx-rest">
            <RestArms />
          </g>
        )}

        {/* Cabeza: casco blanco, visor negro, orejas azules */}
        <rect x={14.5} y={27} width={7} height={15} rx={3.5} fill={BLUE} stroke={INK} strokeWidth={2} />
        <rect x={74.5} y={27} width={7} height={15} rx={3.5} fill={BLUE} stroke={INK} strokeWidth={2} />
        <rect x={20} y={12} width={56} height={46} rx={17} fill={WHITE} stroke={INK} strokeWidth={2.5} />
        <rect x={27} y={20} width={42} height={29} rx={11} fill={INK} />
        <Eyes mood={mood} />

        {mode === "loop" && (
          <>
            <Lupa />
            <Laptop />
            <Paper />
            <Glasses />
          </>
        )}
        {mode === "typing" && <Laptop className="" />}
        {mode === "reviewing" && (
          <>
            <Paper className="" />
            <Glasses className="" />
          </>
        )}
      </g>
    </svg>
  );
}
