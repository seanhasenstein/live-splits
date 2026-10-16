"use client";

import { Card } from "@/components/ui";
import { ordinal } from "@/lib/race-places";

export type TeamRow = {
  label: string;
  /** Our runners (still in the race) with a time here. */
  timed: number;
  /** Top-five average and 1–5 spread, from the gun; null until five have a time. */
  avgMs: number | null;
  spreadMs: number | null;
  /** Our runners' places here, best first (only when places were counted). */
  places: number[];
  /** Places are overall (else among the tracked teams only). */
  overall: boolean;
  /** Team points and place here, when known; `approx` for an estimate from counted places. */
  points: number | null;
  teamPlace: number | null;
  approx: boolean;
};

/**
 * Our team checkpoint by checkpoint, the way a coach watches a race: the places of our scorers
 * (top five, then the 6th and 7th who displace), the team's points and place when places were
 * counted, and the 1–5 spread and top-five average from the times.
 */
export function TeamCard({ name, rows, ft, note }: { name: string; rows: TeamRow[]; ft: (ms: number) => string; note?: string | null }) {
  const shown = rows.filter((r) => r.timed > 0 || r.places.length > 0);
  if (shown.length === 0) return null;
  const withPlaces = shown.some((r) => r.places.length > 0);
  const th = "px-1.5 py-1.5 text-right font-semibold";
  return (
    <Card className="mb-3 overflow-hidden">
      <div className="border-b border-line px-3 py-2">
        <span className="text-sm font-semibold text-ink">Team</span>
        <span className="text-sm text-ink-2"> · {name}</span>
      </div>
      {note ? (
        <p className="px-3 py-2.5 text-[13px] text-ink-2">{note}</p>
      ) : (
        <>
          {withPlaces && (
            <div className="overflow-x-auto">
              <table className="tnum w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] font-semibold tracking-[0.06em] text-ink-2 uppercase">
                    <th className="py-1.5 pr-1.5 pl-3 text-left font-semibold"></th>
                    <th className={th} title="Team place">
                      Pl
                    </th>
                    <th className={th} title="Team points">
                      Pts
                    </th>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <th key={n} className={th}>
                        {n}
                      </th>
                    ))}
                    <th className={`${th} font-normal text-ink-3`}>(6)</th>
                    <th className={`${th} pr-3 font-normal text-ink-3`}>(7)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {/* Only checkpoints where places were counted (the times table below has them all). */}
                  {shown
                    .filter((r) => r.places.length > 0)
                    .map((r) => (
                    <tr key={r.label}>
                      <td className="py-1.5 pr-1.5 pl-3 text-ink-2">{r.label}</td>
                      <td className="px-1.5 py-1.5 text-right font-semibold text-ink">{r.teamPlace !== null ? ordinal(r.teamPlace) : ""}</td>
                      <td className="px-1.5 py-1.5 text-right font-semibold text-ink">{r.points !== null ? `${r.approx ? "≈" : ""}${r.points}` : ""}</td>
                      {Array.from({ length: 7 }, (_, k) => (
                        <td key={k} className={`px-1.5 py-1.5 text-right ${k >= 5 ? "text-ink-3" : "text-ink"} ${k === 6 ? "pr-3" : ""}`}>
                          {r.places[k] !== undefined ? (k >= 5 ? `(${r.places[k]})` : r.places[k]) : ""}
                          {k === 4 && r.places[k] !== undefined && !r.overall && "*"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <table className={`tnum w-full text-sm ${withPlaces ? "border-t border-line" : ""}`}>
            <thead>
              <tr className="border-b border-line text-[11px] font-semibold tracking-[0.06em] text-ink-2 uppercase">
                <th className="py-1.5 pr-1.5 pl-3 text-left font-semibold"></th>
                <th className={th} title="Time between our 1st and 5th runners">
                  1–5 spread
                </th>
                <th className={`${th} pr-3`} title="Average of our top five">
                  Top-5 avg
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => (
                <tr key={r.label}>
                  <td className="py-1.5 pr-1.5 pl-3 text-ink-2">{r.label}</td>
                  <td className="px-1.5 py-1.5 text-right text-ink">{r.spreadMs !== null ? ft(r.spreadMs) : <span className="text-ink-3">{r.timed} of 5</span>}</td>
                  <td className="px-1.5 py-1.5 pr-3 text-right text-ink">{r.avgMs !== null ? ft(r.avgMs) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {withPlaces && (
            <p className="px-3 pt-1 pb-2 text-[11px] text-ink-3">
              1–5: our scorers&rsquo; places; (6) and (7) push other teams back.
              {shown.some((r) => r.approx) && " ≈ points are estimated from the counted places."}
              {shown.some((r) => r.places.length > 0 && !r.overall) && " * among the tracked teams only."}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
