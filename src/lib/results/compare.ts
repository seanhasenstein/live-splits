import type { Race } from "@/lib/db/schema";
import type { RaceState } from "@/lib/replay";
import type { OfficialTimes } from "./import";

/**
 * App taps vs official mat times, per athlete and checkpoint. Errors are
 * app − official in ms (positive = the app was late).
 */

export type CompareCell = { appMs: number | null; officialMs: number | null; errorMs: number | null; edited: boolean; estimate: boolean };
export type CompareRow = { athleteId: string; cells: CompareCell[] };
export type CompareSummary = { checkpointId: string; label: string; n: number; meanAbsMs: number | null; maxAbsMs: number | null; meanMs: number | null };

export function compareRace(race: Pick<Race, "checkpoints" | "gunTimeMs" | "lineup">, state: RaceState, official: OfficialTimes) {
  const rows: CompareRow[] = race.lineup.map(({ athleteId }) => ({
    athleteId,
    cells: race.checkpoints.map((c) => {
      const m = state.get(c.id)?.byAthlete.get(athleteId);
      const appMs = m && !m.missed && m.timeMs !== null && race.gunTimeMs ? m.timeMs - race.gunTimeMs : null;
      const o = official[athleteId];
      const officialMs = o ? (o.byCheckpoint[c.id] ?? (c.kind === "finish" ? o.finishMs : null)) : null;
      return { appMs, officialMs, errorMs: appMs !== null && officialMs !== null ? appMs - officialMs : null, edited: !!m?.edited, estimate: !!m?.estimate };
    }),
  }));

  const summary: CompareSummary[] = race.checkpoints.map((c, i) => {
    const errs = rows.map((r) => r.cells[i].errorMs).filter((e): e is number => e !== null);
    const abs = errs.map(Math.abs);
    return {
      checkpointId: c.id,
      label: c.label,
      n: errs.length,
      meanAbsMs: abs.length ? Math.round(abs.reduce((a, b) => a + b, 0) / abs.length) : null,
      maxAbsMs: abs.length ? Math.max(...abs) : null,
      meanMs: errs.length ? Math.round(errs.reduce((a, b) => a + b, 0) / errs.length) : null,
    };
  });
  return { rows, summary };
}
