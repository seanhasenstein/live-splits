import "server-only";
import type { Meet, Precision, Program } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { normalizeName } from "@/lib/results/match";

/**
 * Every race our athletes have on file, one row per athlete per race, for the reports. The same
 * rules as the record badges (lib/results/bests.ts): official results only, nothing from a meet,
 * race or result marked as not counting for records, nothing below the program's records grade
 * (`counts` says so; such rows are kept, for listing, but never make a best).
 */
export type HistoryRow = {
  athleteId: string;
  meetId: string;
  meetName: string;
  date: string;
  seasonId: string;
  courseId: string | null;
  /** Same meet across years (the series id, else the meet's name). */
  series: string;
  raceId: string;
  raceName: string;
  levelId: string | null;
  distanceId: string | null;
  status: "finished" | "dnf" | "dns" | "dnr" | "dq";
  finishMs: number | null;
  precision: Precision;
  place: number | null;
  /** Runners in the race's full field, when the field was imported. */
  fieldSize: number | null;
  /** Cumulative ms by checkpoint, in course order, labelled; the finish isn't included. */
  splits: { label: string; meters: number; ms: number }[];
  /** Counts toward PR / SB / course bests. */
  counts: boolean;
};

export const seriesOf = (m: Pick<Meet, "meetSeriesId" | "name">) => m.meetSeriesId ?? `name:${normalizeName(m.name)}`;

export async function getTeamHistory(schoolId: string, program: Pick<Program, "_id" | "settings">, athleteIds: string[]): Promise<HistoryRow[]> {
  if (athleteIds.length === 0) return [];
  const db = await getDb();
  const results = await collection(db, "results")
    .find({ schoolId, athleteId: { $in: athleteIds }, raceId: { $ne: null }, supersededBy: null, deletedAt: null })
    .toArray();
  if (results.length === 0) return [];
  const races = await collection(db, "races")
    .find({ _id: { $in: [...new Set(results.map((r) => r.raceId!))] }, deletedAt: null })
    .toArray();
  const raceById = new Map(races.map((r) => [r._id, r]));
  const meets = await collection(db, "meets")
    .find({ _id: { $in: [...new Set(races.map((r) => r.meetId))] }, programId: program._id, deletedAt: null })
    .toArray();
  const meetById = new Map(meets.map((m) => [m._id, m]));
  const fields = await collection(db, "raceEntries")
    .aggregate<{ _id: string; n: number }>([{ $match: { raceId: { $in: races.map((r) => r._id) }, deletedAt: null } }, { $group: { _id: "$raceId", n: { $sum: 1 } } }])
    .toArray();
  const fieldSize = new Map(fields.map((f) => [f._id, f.n]));
  const minGrade = program.settings.recordsStartGrade;

  const rows: HistoryRow[] = [];
  for (const r of results) {
    const race = raceById.get(r.raceId!);
    const meet = race && meetById.get(race.meetId);
    if (!race || !meet || !r.athleteId) continue;
    const finish = r.mark?.type === "time" ? r.mark : null;
    const byId = new Map(race.checkpoints.map((c) => [c.id, c]));
    const splits = r.splits
      .flatMap((s) => {
        const c = byId.get(s.checkpointId);
        return c && c.kind === "split" ? [{ label: c.label, meters: c.distance.meters, ms: s.cumulativeMs }] : [];
      })
      .sort((a, b) => a.meters - b.meters);
    const counts =
      r.status === "finished" &&
      finish !== null &&
      !meet.recordsExclusion &&
      !(r.exclusions.excludeFromPrSb ?? race.exclusions.excludeFromPrSb) &&
      !(r.gradeSnapshot !== null && r.gradeSnapshot < minGrade);
    rows.push({
      athleteId: r.athleteId,
      meetId: meet._id,
      meetName: meet.name,
      date: meet.date,
      seasonId: meet.seasonId,
      courseId: meet.courseId,
      series: seriesOf(meet),
      raceId: race._id,
      raceName: race.name,
      levelId: r.levelId ?? race.lineup.find((l) => l.athleteId === r.athleteId)?.levelId ?? race.levelIds[0] ?? null,
      distanceId: race.distanceId,
      status: r.status,
      finishMs: finish?.value ?? null,
      precision: finish?.precision ?? "seconds",
      place: r.place,
      fieldSize: fieldSize.get(race._id) ?? null,
      splits,
      counts,
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.raceName.localeCompare(b.raceName));
}

/** The fastest counting finish among `rows` (at one distance), or null. */
export function bestOf(rows: HistoryRow[]): HistoryRow | null {
  let best: HistoryRow | null = null;
  for (const r of rows) if (r.counts && r.finishMs !== null && (best === null || r.finishMs < best.finishMs!)) best = r;
  return best;
}
