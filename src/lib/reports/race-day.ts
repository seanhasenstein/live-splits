import type { HistoryRow } from "./history";

/**
 * Race Day Sheet: for the clipboard at the mile marks. Each runner's career and season bests, and
 * their splits on the clock (cumulative) in a few reference races the whole team shares: this meet
 * last year, the latest race on this course this season, and the last race. Then blank columns
 * for today. Pure, so it can be tested without a database.
 */

export type RefRace = { meetId: string; label: string; note: string | null };
export type RefCell = { splits: (number | null)[]; finishMs: number | null; jv: boolean } | null;
export type RaceDayRow = { athleteId: string; careerBest: number | null; seasonBest: number | null; refs: RefCell[] };

export function buildRaceDay(input: {
  meet: { id: string; date: string; seasonId: string; courseId: string | null; series: string };
  /** Today's split checkpoints, in course order (the finish isn't one). */
  checkpoints: { label: string; meters: number }[];
  athleteIds: string[];
  rows: HistoryRow[];
  distanceId: string | null;
}): { refs: RefRace[]; rows: RaceDayRow[] } {
  const { meet } = input;
  const before = input.rows.filter(
    (r) => input.athleteIds.includes(r.athleteId) && r.date < meet.date && r.meetId !== meet.id && (input.distanceId === null || r.distanceId === input.distanceId),
  );
  // Most recent meet first, one entry per meet.
  const meets = [...new Map(before.sort((a, b) => b.date.localeCompare(a.date)).map((r) => [r.meetId, r])).values()];
  const year = (r: HistoryRow) => `'${r.date.slice(2, 4)}`;
  const refs: RefRace[] = [];
  const add = (r: HistoryRow | undefined, note: string | null) => {
    if (r && !refs.some((x) => x.meetId === r.meetId)) refs.push({ meetId: r.meetId, label: `${year(r)} ${r.meetShort}`, note });
  };
  const sameMeet = meets.find((r) => r.series === meet.series);
  add(sameMeet, meet.courseId !== null && sameMeet?.courseId === meet.courseId ? "this course" : "last year");
  add(
    meets.find((r) => r.seasonId === meet.seasonId && meet.courseId !== null && r.courseId === meet.courseId),
    "this course",
  );
  add(
    meets.find((r) => r.seasonId === meet.seasonId),
    "last race",
  );

  const rows = input.athleteIds.map((athleteId): RaceDayRow => {
    const mine = before.filter((r) => r.athleteId === athleteId);
    const best = (rs: HistoryRow[]) => rs.filter((r) => r.counts && r.finishMs !== null).reduce<number | null>((b, r) => (b === null || r.finishMs! < b ? r.finishMs : b), null);
    return {
      athleteId,
      careerBest: best(mine),
      seasonBest: best(mine.filter((r) => r.seasonId === meet.seasonId)),
      refs: refs.map((ref) => {
        const r = mine.find((x) => x.meetId === ref.meetId);
        if (!r) return null;
        // Their split at each of today's checkpoints, matched by distance (a mile is a mile on any course).
        const splits = input.checkpoints.map((c) => r.splits.find((s) => Math.abs(s.meters - c.meters) <= 50)?.ms ?? null);
        return { splits, finishMs: r.status === "finished" ? r.finishMs : null, jv: r.levelId === "jv" };
      }),
    };
  });
  rows.sort((a, b) => (a.seasonBest ?? a.careerBest ?? Infinity) - (b.seasonBest ?? b.careerBest ?? Infinity));
  return { refs, rows };
}
