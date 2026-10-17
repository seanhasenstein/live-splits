import "server-only";
import type { Meet, Precision, Program, Race } from "@/lib/db/schema";
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
export type Best = { ms: number; precision: Precision; meetName: string; date: string };

/** One earlier finish at this distance, with enough to list it, link to it and compare splits against it. */
export type PriorFinish = {
  ms: number;
  precision: Precision;
  meetId: string;
  meetName: string;
  raceId: string;
  raceName: string;
  date: string;
  thisSeason: boolean;
  sameCourse: boolean;
  /** Official mat splits, cumulative ms by checkpoint meters (whole meters). */
  splits: Record<string, number>;
};

export type AthleteBests = {
  pr: Best | null;
  sb: Best | null;
  course: Best | null;
  meet: Best | null;
  /** Every counting finish at this distance, fastest first. */
  finishes: PriorFinish[];
};

export type LineupBests = Record<string, AthleteBests>;

/** Meets of the same name are one series; the schema's series id wins where set. */
const seriesKey = (m: Pick<Meet, "meetSeriesId" | "name">) => m.meetSeriesId ?? `name:${normalizeName(m.name)}`;

export async function getLineupBests(meet: Meet, race: Pick<Race, "lineup" | "distanceId">, program: Pick<Program, "settings"> | null): Promise<LineupBests> {
  const db = await getDb();
  const athleteIds = race.lineup.map((l) => l.athleteId);
  const out: LineupBests = Object.fromEntries(athleteIds.map((id) => [id, { pr: null, sb: null, course: null, meet: null, finishes: [] }]));
  if (athleteIds.length === 0) return out;

  const meets = await collection(db, "meets")
    .find({ schoolId: meet.schoolId, programId: meet.programId, _id: { $ne: meet._id }, date: { $lte: meet.date }, deletedAt: null, recordsExclusion: null }, { projection: { _id: 1, name: 1, date: 1, courseId: 1, seasonId: 1, meetSeriesId: 1 } })
    .toArray();
  if (meets.length === 0) return out;
  const meetById = new Map(meets.map((m) => [m._id, m]));
  const races = await collection(db, "races")
    .find({ meetId: { $in: meets.map((m) => m._id) }, distanceId: race.distanceId, deletedAt: null }, { projection: { _id: 1, meetId: 1, name: 1, checkpoints: 1, exclusions: 1 } })
    .toArray();
  if (races.length === 0) return out;
  const raceById = new Map(races.map((r) => [r._id, r]));
  const results = await collection(db, "results")
    .find(
      { schoolId: meet.schoolId, raceId: { $in: races.map((r) => r._id) }, athleteId: { $in: athleteIds }, status: "finished", "mark.type": "time", supersededBy: null, deletedAt: null },
      { projection: { athleteId: 1, raceId: 1, mark: 1, gradeSnapshot: 1, exclusions: 1, splits: 1 } },
    )
    .toArray();

  const minGrade = program?.settings.recordsStartGrade ?? 0;
  const thisSeries = seriesKey(meet);
  const better = (cur: Best | null, cand: Best) => (cur === null || cand.ms < cur.ms ? cand : cur);
  for (const r of results) {
    const race = raceById.get(r.raceId!)!;
    // A result's own flag, when set, overrides the race's.
    if (r.exclusions.excludeFromPrSb ?? race.exclusions.excludeFromPrSb) continue;
    if (r.gradeSnapshot !== null && r.gradeSnapshot < minGrade) continue;
    if (r.mark?.type !== "time") continue;
    const m = meetById.get(race.meetId)!;
    const best: Best = { ms: r.mark.value, precision: r.mark.precision, meetName: m.name, date: m.date };
    const b = out[r.athleteId!];
    b.pr = better(b.pr, best);
    const thisSeason = m.seasonId === meet.seasonId;
    const sameCourse = !!meet.courseId && m.courseId === meet.courseId;
    if (thisSeason) b.sb = better(b.sb, best);
    if (sameCourse) b.course = better(b.course, best);
    if (seriesKey(m) === thisSeries) b.meet = better(b.meet, best);
    // Keyed by whole meters so a Mile 1 at 1609.344 m and one stored as 1609 m line up.
    const metersOf = new Map(race.checkpoints.map((c) => [c.id, String(Math.round(c.distance.meters))]));
    const splits: Record<string, number> = {};
    for (const s of r.splits) {
      const key = s.source === "mat" ? metersOf.get(s.checkpointId) : undefined;
      if (key) splits[key] = s.cumulativeMs;
    }
    b.finishes.push({ ms: r.mark.value, precision: r.mark.precision, meetId: m._id, meetName: m.name, raceId: race._id, raceName: race.name, date: m.date, thisSeason, sameCourse, splits });
  }
  for (const b of Object.values(out)) b.finishes.sort((x, y) => x.ms - y.ms || y.date.localeCompare(x.date));
  return out;
}
