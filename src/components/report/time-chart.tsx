import { formatElapsed } from "@/lib/time";

export type ChartPoint = {
  label: string;
  /** A second line under the label (grade, "JV"). */
  sub?: string;
  ms: number;
  /** best: filled green; gold: gold dot (season best); ring: gray ring (this course). */
  mark?: "best" | "gold" | "ring";
};

/**
 * Finish times in race order, faster higher, every point labelled with its time: the chart on the
 * athlete pages. Plain SVG, so it prints sharp at any size.
 */
export function TimeChart({ points, height = 170 }: { points: ChartPoint[]; height?: number }) {
  if (points.length < 2) return null;
  const W = 720;
  const pad = { l: 16, r: 16, t: 22, b: 34 };
  const ms = points.map((p) => p.ms);
  const lo = Math.min(...ms);
  const hi = Math.max(...ms);
  const span = Math.max(hi - lo, 10_000);
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * (i + 0.5)) / points.length;
  // Faster (smaller) is higher.
  const y = (v: number) => pad.t + ((height - pad.t - pad.b) * (v - lo)) / span;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.ms).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label="Finish times by race, faster higher">
      <line x1={pad.l} x2={W - pad.r} y1={height - pad.b + 4} y2={height - pad.b + 4} stroke="var(--r-line)" />
      <path d={path} fill="none" stroke="var(--r-green)" strokeWidth={1.6} strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          {p.mark === "ring" && <circle cx={x(i)} cy={y(p.ms)} r={7} fill="none" stroke="var(--r-ink-3)" strokeWidth={1.2} />}
          <circle
            cx={x(i)}
            cy={y(p.ms)}
            r={p.mark === "best" || p.mark === "gold" ? 4.5 : 3.2}
            fill={p.mark === "best" ? "var(--r-green)" : p.mark === "gold" ? "var(--r-gold)" : "#fff"}
            stroke={p.mark === "gold" ? "var(--r-gold)" : "var(--r-green)"}
            strokeWidth={1.4}
          />
          <text x={x(i)} y={y(p.ms) - 9} textAnchor="middle" fontSize={10.5} fontWeight={p.mark ? 700 : 500} fill={p.mark === "gold" ? "var(--r-gold-text)" : "var(--r-ink)"}>
            {formatElapsed(p.ms, "seconds")}
          </text>
          <text x={x(i)} y={height - pad.b + 17} textAnchor="middle" fontSize={9.5} fill="var(--r-ink-2)">
            {p.label}
          </text>
          {p.sub && (
            <text x={x(i)} y={height - pad.b + 28} textAnchor="middle" fontSize={8} fill="var(--r-ink-3)">
              {p.sub}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
