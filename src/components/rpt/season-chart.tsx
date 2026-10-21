"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type PointerEvent, useState } from "react";
import { ordinal } from "@/lib/reports/athlete";
import { formatElapsed } from "@/lib/time";

/** One season's race at a meet, for the card that opens on a meet's column. */
export type ChartRace = {
  year: string;
  ms: number | null;
  status: string;
  place: number | null;
  jv: boolean;
  careerBest: boolean;
  seasonBest: boolean;
  letter: boolean;
  /** Each mile on its own then the last stretch; shown for the newest season. */
  segments: (number | null)[];
  href: string;
};

const t = (ms: number) => formatElapsed(Math.floor(ms / 1000) * 1000, "seconds");

/**
 * Finish times by meet, a line per season (the profile PDF's chart): this season solid and strongest,
 * older seasons lighter and dashed, each labelled at its end; faster is higher, gridlines every 30 s or more,
 * slots still to come shaded. Plain SVG in the report's colors.
 *
 * On screen a meet's whole column is the target: hovering it (or tapping it, or arrow keys) opens a
 * card with that meet across the years. A click goes to the newest race's results; on touch the first
 * tap opens the card, which has the link. Printed, it's the plain chart.
 */
export function SeasonChart({
  slots,
  seasons,
  upcoming,
  races,
  height = 150,
}: {
  slots: string[];
  seasons: { year: string; points: (number | null)[] }[];
  upcoming: boolean[];
  /** Per slot, newest season first. */
  races?: ChartRace[][];
  height?: number;
}) {
  const router = useRouter();
  const [active, setActive] = useState<number | null>(null);
  const [touch, setTouch] = useState(false);
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

  const interactive = !!races;
  const slotAt = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = (((e.clientX - r.left) / r.width) * W - pad.l) / colW;
    return i >= 0 && i < slots.length ? Math.floor(i) : null;
  };
  const go = (i: number) => {
    const href = races?.[i]?.[0]?.href;
    if (href) router.push(href);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(slots.length - 1, Math.max(0, (a ?? (d > 0 ? -1 : slots.length)) + d)));
    } else if (e.key === "Enter" && active !== null) go(active);
    else if (e.key === "Escape") setActive(null);
  };
  const card = active !== null && races ? races[active] : null;
  const leftPct = active === null ? 0 : (x(active) / W) * 100;

  return (
    <div className="chart-wrap" onMouseLeave={() => !touch && setActive(null)}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        style={{ width: "100%", height: "auto", display: "block", cursor: interactive && active !== null && races?.[active]?.length ? "pointer" : undefined, outline: "none" }}
        role="img"
        aria-label="Finish times by meet, a line per season, faster higher. Arrow keys step through the meets."
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={interactive ? onKey : undefined}
        onBlur={() => !touch && setActive(null)}
        onPointerMove={interactive ? (e) => e.pointerType === "mouse" && setActive(slotAt(e)) : undefined}
        onPointerDown={
          interactive
            ? (e) => {
                const i = slotAt(e);
                if (e.pointerType === "mouse") {
                  if (i !== null) go(i);
                  return;
                }
                setTouch(true);
                setActive((a) => (a === i ? null : i));
              }
            : undefined
        }
      >
        {firstUpcoming >= 0 && <rect x={pad.l + colW * firstUpcoming} y={pad.t - 4} width={colW * (slots.length - firstUpcoming)} height={height - pad.t - pad.b + 8} fill="var(--ghost)" opacity={0.18} />}
        {active !== null && <rect className="no-print" x={pad.l + colW * active} y={pad.t - 4} width={colW} height={height - pad.t - pad.b + 8} fill="var(--green)" opacity={0.08} />}
        {grid.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--rule-light)" strokeWidth={0.8} />
            <text x={pad.l - 8} y={y(v) + 3.5} textAnchor="end" fontSize={9.5} fill="var(--soft)">
              {formatElapsed(v, "seconds")}
            </text>
          </g>
        ))}
        {slots.map((s, i) => (
          <text key={s + i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={9} fill={i === active ? "var(--ink)" : "var(--soft)"} fontWeight={i === active ? 700 : 400}>
            {s}
          </text>
        ))}
        {seasons.map((s, k) => {
          const st = styles(k, seasons.length);
          const pts = s.points.map((p, i) => (p === null ? null : { i, x: x(i), y: y(p) })).filter((p): p is { i: number; x: number; y: number } => p !== null);
          if (pts.length === 0) return null;
          const last = pts[pts.length - 1];
          const newest = k === seasons.length - 1;
          return (
            <g key={s.year} opacity={st.opacity}>
              {pts.length > 1 && <path d={pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" stroke={st.stroke} strokeWidth={st.width} strokeDasharray={st.dash} strokeLinejoin="round" strokeLinecap="round" />}
              {pts.map((p) => (newest || p.i === active) && <circle key={p.i} cx={p.x} cy={p.y} r={p.i === active ? 4.6 : 3.2} fill={newest ? st.stroke : "var(--paper)"} stroke={st.stroke} strokeWidth={newest ? 0 : 1.6} />)}
              <text x={last.x + 8} y={last.y + 3.5} fontSize={9.5} fontWeight={700} fill={st.stroke}>
                {s.year}
              </text>
            </g>
          );
        })}
      </svg>
      {active !== null && (
        <div className={`chart-card no-print ${touch ? "pinned" : ""}`} style={{ left: `clamp(110px, ${leftPct}%, calc(100% - 110px))` }} role="status">
          <div className="hd">{slots[active]}</div>
          {card && card.length > 0 ? (
            card.map((r, k) => (
              <div key={r.year} className="rw">
                <span className="yr">{r.year}</span>
                <span className={`tm ${r.careerBest ? "cb" : r.seasonBest ? "sb" : ""} ${r.letter ? "let" : ""}`}>{r.ms !== null ? t(r.ms) : r.status.toUpperCase()}</span>
                <span className="pl">{r.place ? `${ordinal(r.place)}${r.jv ? " JV" : ""}` : ""}</span>
                {r.careerBest ? <span className="tag cb">PR</span> : r.seasonBest ? <span className="tag sb">SB</span> : null}
                {k === 0 && r.segments.some((s) => s !== null) && <div className="segs">{r.segments.map((s) => (s === null ? "—" : t(s))).join(" · ")}</div>}
              </div>
            ))
          ) : (
            <div className="rw empty">{upcoming[active] ? "Still to come this season" : "No race here"}</div>
          )}
          {card?.[0] &&
            (touch ? (
              <Link className="go" href={card[0].href}>
                View {card[0].year} results
              </Link>
            ) : (
              <div className="go">Click for {card[0].year} results</div>
            ))}
        </div>
      )}
    </div>
  );
}
