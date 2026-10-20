import type { AthleteRace } from "@/lib/reports/athlete";
import { ordinal, segmentsAt } from "@/lib/reports/athlete";
import { segmentLength } from "@/lib/pace";
import { formatElapsed } from "@/lib/time";
import { Grade, Pill, td, th } from "./report";

/**
 * An athlete's races as the reports list them: the finish, each mile on its own, place in the field
 * and among our runners in that race. The career-best row is tinted green; the season best (when it
 * isn't also the career best) gold. `career` adds the field size and the change from the race before.
 */
export function AthleteRacesTable({
  races,
  splitLabels,
  finishMeters,
  label,
  career = false,
}: {
  races: AthleteRace[];
  splitLabels: { label: string; meters: number }[];
  finishMeters: number | null;
  /** The first column's text for a race ("2025 Crusader Challenge", "KML"). */
  label: (r: AthleteRace) => string;
  career?: boolean;
}) {
  const t = (ms: number | null) => (ms === null ? "—" : formatElapsed(ms, "seconds"));
  const last = finishMeters !== null && splitLabels.length > 0 ? segmentLength(finishMeters - splitLabels[splitLabels.length - 1].meters) : null;
  const segHeads = [...splitLabels.map((s) => s.label), last ? `Final ${last.replace(" mi", "")}` : "To finish"];
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={th}>Race</th>
          <th className={`${th} text-right`}>Time</th>
          {segHeads.map((h) => (
            <th key={h} className={`${th} text-right`}>
              {h}
            </th>
          ))}
          <th className={`${th} text-right`}>Place</th>
          <th className={`${th} text-right`}>Team place</th>
          {career && <th className={`${th} text-right`}>Vs prev</th>}
        </tr>
      </thead>
      <tbody>
        {races.map((r) => {
          const tint = r.pr ? "bg-[var(--r-green-tint)]" : r.sb ? "bg-[var(--r-cream)]" : "";
          const segs = segmentsAt(r, splitLabels);
          return (
            <tr key={r.raceId} className={tint}>
              <td className={`${td} pr-2`}>
                {label(r)}
                {r.grade !== null && r.grade <= 12 && <Grade>Gr {r.grade}</Grade>}
                {r.courseBest && <Pill kind="course" className="ml-1.5" />}
              </td>
              <td className={`${td} text-right font-bold ${r.pr ? "text-[var(--r-green)]" : r.sb ? "text-[var(--r-gold-text)]" : ""}`}>{r.status === "finished" ? t(r.finishMs) : r.status.toUpperCase()}</td>
              {segs.map((ms, i) => (
                <td key={i} className={`${td} text-right`}>
                  {t(ms)}
                </td>
              ))}
              <td className={`${td} text-right`}>
                {r.place ? ordinal(r.place) : "—"}
                {r.place && r.levelId === "jv" ? <span className="text-[var(--r-ink-2)]"> JV</span> : null}
                {career && r.place && r.fieldSize ? <span className="text-[var(--r-ink-3)]"> of {r.fieldSize}</span> : null}
              </td>
              <td className={`${td} text-right`}>{r.teamPlace ? `${r.teamPlace.place} of ${r.teamPlace.of}` : "—"}</td>
              {career && (
                <td className={`${td} text-right font-medium ${r.vsPrev === null ? "" : r.vsPrev < 0 ? "text-[var(--r-green)]" : r.vsPrev > 0 ? "text-[var(--r-red)]" : ""}`}>
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
