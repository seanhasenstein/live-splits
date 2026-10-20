import type { AthleteRace } from "@/lib/reports/athlete";
import { ordinal, segmentsAt } from "@/lib/reports/athlete";
import { segmentLength } from "@/lib/pace";
import { formatElapsed } from "@/lib/time";
import { Pill, td, th } from "./report";

/**
 * An athlete's races as the reports list them: segment splits, finish with its badges, place in the
 * field and among the team, and the change from the race before. The row holding the career best is
 * tinted green; the season best (when it isn't also the career best) gold.
 */
export function AthleteRacesTable({ races, splitLabels, finishMeters, showVsPrev = true, tintBests = true }: { races: AthleteRace[]; splitLabels: { label: string; meters: number }[]; finishMeters: number | null; showVsPrev?: boolean; tintBests?: boolean }) {
  const t = (ms: number | null) => (ms === null ? "—" : formatElapsed(ms, "seconds"));
  const last = finishMeters !== null && splitLabels.length > 0 ? segmentLength(finishMeters - splitLabels[splitLabels.length - 1].meters) : null;
  const segHeads = [...splitLabels.map((s) => s.label), last ? `Last ${last}` : "To finish"];
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={th}>Race</th>
          {segHeads.map((h) => (
            <th key={h} className={`${th} text-right`}>
              {h}
            </th>
          ))}
          <th className={`${th} text-right`}>Finish</th>
          <th className={`${th} text-right`}>Place</th>
          <th className={`${th} text-right`}>Team</th>
          {showVsPrev && <th className={`${th} text-right`}>Vs prev</th>}
        </tr>
      </thead>
      <tbody>
        {races.map((r) => {
          const tint = tintBests && r.pr ? "bg-[#eef4ec]" : tintBests && r.sb ? "bg-[var(--r-cream)]" : "";
          const segs = segmentsAt(r, splitLabels);
          return (
            <tr key={r.raceId} className={tint}>
              <td className={`${td} pr-2`}>
                <span className="font-medium">{r.label}</span>
                {r.levelId === "jv" && <Pill kind="jv" className="ml-1" />}
                {r.courseBest && <Pill kind="course" className="ml-1" />}
              </td>
              {segs.map((ms, i) => (
                <td key={i} className={`${td} text-right text-[var(--r-ink-2)]`}>
                  {t(ms)}
                </td>
              ))}
              <td className={`${td} text-right font-semibold ${r.pr ? "text-[var(--r-green-text)]" : ""}`}>
                {r.status === "finished" ? t(r.finishMs) : r.status.toUpperCase()}
                {r.pr && <Pill kind="pr" className="ml-1" />}
                {r.sb && !r.pr && <Pill kind="sb" className="ml-1" />}
              </td>
              <td className={`${td} text-right`}>
                {r.place ? ordinal(r.place) : "—"}
                {r.place && r.fieldSize ? <span className="text-[var(--r-ink-3)]"> of {r.fieldSize}</span> : null}
              </td>
              <td className={`${td} text-right text-[var(--r-ink-2)]`}>{r.teamPlace ? `${r.teamPlace.place} of ${r.teamPlace.of}` : "—"}</td>
              {showVsPrev && (
                <td className={`${td} text-right font-medium ${r.vsPrev === null ? "" : r.vsPrev < 0 ? "text-[var(--r-green-text)]" : r.vsPrev > 0 ? "text-[var(--r-red)]" : ""}`}>
                  {r.vsPrev === null ? "" : r.vsPrev === 0 ? "±0:00" : `${r.vsPrev < 0 ? "−" : "+"}${formatElapsed(Math.abs(r.vsPrev), "seconds")}`}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The big-number strip at the top of an athlete page. */
export function KpiStrip({ items }: { items: { label: string; value: string; note?: string; tone?: "green" | "gold" }[] }) {
  return (
    <div className="mb-5 grid grid-cols-4 gap-px overflow-hidden rounded-md bg-[var(--r-line)] max-sm:grid-cols-2">
      {items.map((k) => (
        <div key={k.label} className="bg-[var(--r-cream)] px-3 py-2.5">
          <div className="text-[8px] font-bold tracking-[0.12em] text-[var(--r-ink-2)] uppercase">{k.label}</div>
          <div className={`mt-0.5 text-[20px] leading-tight font-extrabold ${k.tone === "gold" ? "text-[var(--r-gold-text)]" : k.tone === "green" ? "text-[var(--r-green)]" : "text-[var(--r-ink)]"}`}>{k.value}</div>
          {k.note && <div className="mt-0.5 truncate text-[9px] text-[var(--r-ink-2)]">{k.note}</div>}
        </div>
      ))}
    </div>
  );
}
