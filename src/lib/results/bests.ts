import "server-only";
import type { Meet, Program, Race } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { normalizeName } from "./match";

/**
 * What each runner in a lineup had to beat coming into this race: their best
 * time at this distance (PR), this season (SB), on this course layout, and at
 * this meet in earlier years. Built from official results only, across every
 * season the app knows, so the badges on the board and the sheet mean the
 * same thing a coach means by them.
 *
 * A result doesn't count when the runner, the race or the meet is marked as
 * not counting for records (a short course, a wrong turn), when the race was
 * a different distance, or when it was run below the program's records grade.
 * Only results from other, earlier (or same-day) meets count: this race is
 * what's being judged.
 */
export type Best = { ms: number; meetName: string; date: string };

export type AthleteBests = {
  pr: Best | null;
  sb: Best | null;
  course: Best | null;
  meet: Best | null;
};

export type LineupBests = Record<string, AthleteBests>;

/** Meets of the same name are one series; the schema's series id wins where set. */
const seriesKey = (m: Pick<Meet, "meetSeriesId" | "name">) => m.meetSeriesId ?? `name:${normalizeName(m.name)}`;

export async function getLineupBests(meet: Meet, race: Pick<Race, "lineup" | "distanceId">, program: Pick<Program, "settings"> | null): Promise<LineupBests> {
  const db = await getDb();
  const athleteIds = race.lineup.map((l) => l.athleteId);
  const out: LineupBests = Object.fromEntries(athleteIds.map((id) => [id, { pr: null, sb: null, course: null, meet: null }]));
  if (athleteIds.length === 0) return out;

  const meets = await collection(db, "meets")
    .find({ schoolId: meet.schoolId, programId: meet.programId, _id: { $ne: meet._id }, date: { $lte: meet.date }, deletedAt: null, recordsExclusion: null }, { projection: { _id: 1, name: 1, date: 1, courseId: 1, seasonId: 1, meetSeriesId: 1 } })
    .toArray();
  if (meets.length === 0) return out;
  const meetById = new Map(meets.map((m) => [m._id, m]));
  const races = await collection(db, "races")
    .find({ meetId: { $in: meets.map((m) => m._id) }, distanceId: race.distanceId, deletedAt: null, "exclusions.excludeFromPrSb": false }, { projection: { _id: 1, meetId: 1 } })
    .toArray();
  if (races.length === 0) return out;
  const raceById = new Map(races.map((r) => [r._id, r]));
  const results = await collection(db, "results")
    .find(
      { schoolId: meet.schoolId, raceId: { $in: races.map((r) => r._id) }, athleteId: { $in: athleteIds }, status: "finished", "mark.type": "time", supersededBy: null, deletedAt: null },
      { projection: { athleteId: 1, raceId: 1, mark: 1, gradeSnapshot: 1, exclusions: 1 } },
    )
    .toArray();

  const minGrade = program?.settings.recordsStartGrade ?? 0;
  const thisSeries = seriesKey(meet);
  const better = (cur: Best | null, cand: Best) => (cur === null || cand.ms < cur.ms ? cand : cur);
  for (const r of results) {
    if (r.exclusions.excludeFromPrSb) continue;
    if (r.gradeSnapshot !== null && r.gradeSnapshot < minGrade) continue;
    if (r.mark?.type !== "time") continue;
    const m = meetById.get(raceById.get(r.raceId!)!.meetId)!;
    const best: Best = { ms: r.mark.value, meetName: m.name, date: m.date };
    const b = out[r.athleteId!];
    b.pr = better(b.pr, best);
    if (m.seasonId === meet.seasonId) b.sb = better(b.sb, best);
    if (meet.courseId && m.courseId === meet.courseId) b.course = better(b.course, best);
    if (seriesKey(m) === thisSeries) b.meet = better(b.meet, best);
  }
  return out;
}
