import "server-only";
import type { Precision } from "@/lib/db/schema";
import type { Meet, Race } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";

/**
 * What the lineup has run before this race, for sorting the record screen
 * and for the "vs last meet" line on a tile. Built from imported results
 * (official finish + mat splits), so it only knows about meets that were
 * imported. Splits are keyed by checkpoint distance in meters so a Mile 1
 * from another race lines up with this race's Mile 1.
 */
export type PriorRace = {
  id: string;
  /** "Nightfall Classic · Girls" */
  label: string;
  /** Local meet date, ISO. */
  date: string;
  courseId: string | null;
  sameCourse: boolean;
};

export type PriorResult = {
  raceId: string;
  finishMs: number | null;
  /** What the official sheet carried, for display. */
  precision: Precision;
  status: string;
  /** Mat split cumulative ms by checkpoint meters. */
  splits: Record<string, number>;
  /** Counts toward season best. */
  prSb: boolean;
};

export type LineupHistory = {
  /** Races at this season's other meets that any of the lineup has a result in, newest first. */
  races: PriorRace[];
  /** Per athlete, newest race first. */
  byAthlete: Record<string, PriorResult[]>;
};

export async function getLineupHistory(meet: Meet, race: Pick<Race, "lineup">): Promise<LineupHistory> {
  const db = await getDb();
  const athleteIds = race.lineup.map((l) => l.athleteId);
  if (athleteIds.length === 0) return { races: [], byAthlete: {} };

  // Every result of theirs from this season's other meets.
  const seasonMeets = await collection(db, "meets")
    .find({ schoolId: meet.schoolId, seasonId: meet.seasonId, _id: { $ne: meet._id }, deletedAt: null }, { projection: { _id: 1, name: 1, date: 1, courseId: 1 } })
    .toArray();
  const meetById = new Map(seasonMeets.map((m) => [m._id, m]));
  const races = await collection(db, "races")
    .find({ meetId: { $in: seasonMeets.map((m) => m._id) }, deletedAt: null }, { projection: { _id: 1, meetId: 1, name: 1, checkpoints: 1 } })
    .toArray();
  const raceById = new Map(races.map((r) => [r._id, r]));
  const results = await collection(db, "results")
    .find({ schoolId: meet.schoolId, raceId: { $in: races.map((r) => r._id) }, athleteId: { $in: athleteIds }, supersededBy: null, deletedAt: null })
    .toArray();

  const dateOf = (raceId: string) => meetById.get(raceById.get(raceId)?.meetId ?? "")?.date ?? "";
  const used = new Set(results.map((r) => r.raceId!));
  const priorRaces: PriorRace[] = [...used]
    .map((id) => raceById.get(id)!)
    .map((r) => {
      const m = meetById.get(r.meetId)!;
      return { id: r._id, label: `${m.name} · ${r.name}`, date: m.date, courseId: m.courseId, sameCourse: !!meet.courseId && m.courseId === meet.courseId };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label));

  const byAthlete: Record<string, PriorResult[]> = {};
  for (const r of results) {
    const race = raceById.get(r.raceId!)!;
    const metersOf = new Map(race.checkpoints.map((c) => [c.id, String(c.distance.meters)]));
    const splits: Record<string, number> = {};
    for (const s of r.splits) {
      if (s.source !== "mat") continue;
      const key = metersOf.get(s.checkpointId);
      if (key) splits[key] = s.cumulativeMs;
    }
    (byAthlete[r.athleteId!] ??= []).push({
      raceId: r.raceId!,
      finishMs: r.mark?.type === "time" ? r.mark.value : null,
      precision: r.mark?.type === "time" ? r.mark.precision : "tenths",
      status: r.status,
      splits,
      prSb: r.status === "finished" && !r.exclusions.excludeFromPrSb,
    });
  }
  for (const list of Object.values(byAthlete)) list.sort((a, b) => dateOf(b.raceId).localeCompare(dateOf(a.raceId)));
  return { races: priorRaces, byAthlete };
}
