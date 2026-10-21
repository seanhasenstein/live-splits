import { formatElapsed } from "@/lib/time";

/**
 * Finish times by meet, a line per season (the profile PDF's chart): this season solid and strongest,
 * older seasons lighter and dashed, each labelled at its end; faster is higher, gridlines every 30 s or more,
 * slots still to come shaded. Plain SVG in the report's colors.
 */
export function SeasonChart({ slots, seasons, upcoming, height = 150 }: { slots: string[]; seasons: { year: string; points: (number | null)[] }[]; upcoming: boolean[]; height?: number }) {
  const all = seasons.flatMap((s) => s.points.filter((p): p is number => p !== null));
  if (all.length < 2 || slots.length < 2) return null;
  const W = 760;
  const pad = { l: 52, r: 44, t: 12, b: 22 };
  // 30 s gridlines, wider when the times spread far (a first race well off the rest).
  const spread = Math.max(...all) - Math.min(...all);
  const step = spread > 6 * 60_000 ? 120_000 : spread > 3 * 60_000 ? 60_000 : 30_000;
  const lo = Math.floor(Math.min(...all) / step) * step;
  const hi = Math.max(Math.ceil(Math.max(...all) / step) * step, lo + step);
  const colW = (W - pad.l - pad.r) / slots.length;
  const x = (i: number) => pad.l + colW * (i + 0.5);
  const y = (v: number) => pad.t + ((height - pad.t - pad.b) * (v - lo)) / (hi - lo);
  const grid: number[] = [];
  for (let v = lo; v <= hi; v += step) grid.push(v);
  // Newest season last, so it's drawn on top.
  const styles = (k: number, n: number) => {
    const age = n - 1 - k;
    return age === 0 ? { stroke: "var(--green)", width: 2.8, dash: undefined, opacity: 1 } : { stroke: "var(--green)", width: 1.6, dash: age === 1 ? "7 3 2 3" : "4 4", opacity: age === 1 ? 0.75 : 0.5 };
  };
  const firstUpcoming = upcoming.indexOf(true);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Finish times by meet, a line per season, faster higher">
      {firstUpcoming >= 0 && <rect x={pad.l + colW * firstUpcoming} y={pad.t - 4} width={colW * (slots.length - firstUpcoming)} height={height - pad.t - pad.b + 8} fill="var(--ghost)" opacity={0.18} />}
      {grid.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--rule-light)" strokeWidth={0.8} />
          <text x={pad.l - 8} y={y(v) + 3.5} textAnchor="end" fontSize={9.5} fill="var(--soft)">
            {formatElapsed(v, "seconds")}
          </text>
        </g>
      ))}
      {slots.map((s, i) => (
        <text key={s + i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={9} fill="var(--soft)">
          {s}
        </text>
      ))}
      {seasons.map((s, k) => {
        const st = styles(k, seasons.length);
        const pts = s.points.map((p, i) => (p === null ? null : { x: x(i), y: y(p) })).filter((p): p is { x: number; y: number } => p !== null);
        if (pts.length === 0) return null;
        const last = pts[pts.length - 1];
        return (
          <g key={s.year} opacity={st.opacity}>
            {pts.length > 1 && <path d={pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" stroke={st.stroke} strokeWidth={st.width} strokeDasharray={st.dash} strokeLinejoin="round" strokeLinecap="round" />}
            {k === seasons.length - 1 && pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3.2} fill={st.stroke} />)}
            <text x={last.x + 8} y={last.y + 3.5} fontSize={9.5} fontWeight={700} fill={st.stroke}>
              {s.year}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
