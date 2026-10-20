import { formatElapsed } from "@/lib/time";

export type ChartPoint = {
  label: string;
  ms: number;
  /** best: filled green dot (career best); gold: gold dot labelled "season best"; ring: gray ring (this course). */
  mark?: "best" | "gold" | "ring";
};

/**
 * Finish times in race order, faster higher, with time gridlines down the left: the chart on the
 * athlete pages. Plain SVG, so it prints sharp at any size and follows the report's colors.
 */
export function TimeChart({ points, height = 130 }: { points: ChartPoint[]; height?: number }) {
  if (points.length < 2) return null;
  const W = 760;
  const pad = { l: 46, r: 20, t: 22, b: 22 };
  const ms = points.map((p) => p.ms);
  // Gridlines every 30 s, rounded out to whole steps around the data.
  const step = 30_000;
  const lo = Math.floor(Math.min(...ms) / step) * step;
  const hi = Math.max(Math.ceil(Math.max(...ms) / step) * step, lo + step);
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * (i + 0.5)) / points.length;
  const y = (v: number) => pad.t + ((height - pad.t - pad.b) * (v - lo)) / (hi - lo);
  const grid: number[] = [];
  for (let v = lo; v <= hi; v += step) grid.push(v);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.ms).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label="Finish times by race, faster higher">
      {grid.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--r-line)" />
          <text x={pad.l - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--r-ink-2)">
            {formatElapsed(v, "seconds")}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--r-green-fill)" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          {p.mark === "ring" && <circle cx={x(i)} cy={y(p.ms)} r={6.5} fill="var(--r-bg)" stroke="var(--r-ink-2)" strokeWidth={1.4} />}
          <circle cx={x(i)} cy={y(p.ms)} r={p.mark === "gold" || p.mark === "best" ? 5 : 3} fill={p.mark === "gold" ? "var(--r-gold)" : "var(--r-green-fill)"} />
          {p.mark === "gold" && (
            <text x={x(i)} y={y(p.ms) - 10} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--r-gold-text)">
              {formatElapsed(p.ms, "seconds")} season best
            </text>
          )}
          <text x={x(i)} y={height - 5} textAnchor="middle" fontSize={10} fill="var(--r-ink-2)">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
