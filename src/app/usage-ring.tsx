/** Anillo de progreso del uso semanal: azul, ámbar desde el 80 % y rojo al llegar al límite. */
export function UsageRing({ share, size = 16 }: { share: number; size?: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, share));
  const tone = v >= 1 ? "text-bad" : v >= 0.8 ? "text-warn" : "text-accent";
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={`shrink-0 -rotate-90 ${tone}`} aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="2.5" />
      {v > 0 && (
        <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} />
      )}
    </svg>
  );
}
