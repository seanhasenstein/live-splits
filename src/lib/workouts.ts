import "server-only";
import type { Workout, WorkoutTemplate } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { describePlan } from "@/lib/workout-plan";
import { replayWorkout, summarize } from "@/lib/workout-replay";

export async function listWorkouts(schoolId: string): Promise<Workout[]> {
  return collection(await getDb(), "workouts").find({ schoolId, deletedAt: null }).sort({ date: -1, createdAt: -1 }).toArray();
}

export async function listTemplates(schoolId: string): Promise<WorkoutTemplate[]> {
  return collection(await getDb(), "workoutTemplates").find({ schoolId, deletedAt: null }).sort({ name: 1 }).toArray();
}

export async function getWorkout(id: string): Promise<Workout | null> {
  return collection(await getDb(), "workouts").findOne({ _id: id, deletedAt: null });
}

/**
 * Each athlete's 5K this season and ever, from official finished results, for
 * proposing workout goals. Results excluded from records don't count here
 * either: a short course would set goals too fast.
 */
export async function fiveKBests(schoolId: string, seasonId: string, athleteIds: string[]): Promise<Record<string, { sb: number | null; pr: number | null }>> {
  const out: Record<string, { sb: number | null; pr: number | null }> = Object.fromEntries(athleteIds.map((id) => [id, { sb: null, pr: null }]));
  if (athleteIds.length === 0) return out;
  const db = await getDb();
  const distances = await collection(db, "distances").find({ sport: "xc", meters: 5000 }).toArray();
  const races = await collection(db, "races")
    .find({ schoolId, distanceId: { $in: distances.map((d) => d._id) }, deletedAt: null }, { projection: { _id: 1, meetId: 1, exclusions: 1 } })
    .toArray();
  const meets = await collection(db, "meets")
    .find({ _id: { $in: [...new Set(races.map((r) => r.meetId))] }, deletedAt: null, recordsExclusion: null }, { projection: { _id: 1, seasonId: 1 } })
    .toArray();
  const seasonOf = new Map(meets.map((m) => [m._id, m.seasonId]));
  const raceById = new Map(races.filter((r) => seasonOf.has(r.meetId)).map((r) => [r._id, r]));
  const results = await collection(db, "results")
    .find({ schoolId, raceId: { $in: [...raceById.keys()] }, athleteId: { $in: athleteIds }, status: "finished", "mark.type": "time", supersededBy: null, deletedAt: null }, { projection: { athleteId: 1, raceId: 1, mark: 1, exclusions: 1 } })
    .toArray();
  for (const r of results) {
    const race = raceById.get(r.raceId!)!;
    if (r.exclusions.excludeFromPrSb ?? race.exclusions.excludeFromPrSb) continue;
    if (r.mark?.type !== "time") continue;
    const b = out[r.athleteId!];
    if (b.pr === null || r.mark.value < b.pr) b.pr = r.mark.value;
    if (seasonOf.get(race.meetId) === seasonId && (b.sb === null || r.mark.value < b.sb)) b.sb = r.mark.value;
  }
  return out;
}

/** An athlete's run of the same reps on an earlier day, for "last time" on their sheet. */
export type LastTime = {
  workoutId: string;
  date: string;
  /** Each rep's time, in order; null where they have none. */
  repMs: (number | null)[];
  avgPaceMsPerKm: number | null;
  avgDeltaMs: number | null;
};

/**
 * For each athlete in the workout, the most recent earlier workout with the
 * same reps ("12 × 400m", whatever the rests) where they ran at least one.
 */
export async function lastTimeRan(workout: Workout): Promise<Record<string, LastTime>> {
  const db = await getDb();
  const signature = describePlan(workout.sets);
  const earlier = (
    await collection(db, "workouts")
      .find({ schoolId: workout.schoolId, programId: workout.programId, deletedAt: null, date: { $lte: workout.date }, _id: { $ne: workout._id } })
      .sort({ date: -1, createdAt: -1 })
      .limit(60)
      .toArray()
  ).filter((w) => describePlan(w.sets) === signature && (w.date < workout.date || w.createdAt < workout.createdAt));
  const out: Record<string, LastTime> = {};
  const want = new Set(workout.athletes.map((a) => a.athleteId));
  // Newest first; stop once everyone has one (or after a handful of workouts).
  for (const w of earlier.slice(0, 8)) {
    if (want.size === 0) break;
    const events = await collection(db, "workoutEvents").find({ workoutId: w._id }).toArray();
    const state = replayWorkout(w, events);
    for (const [id, list] of state.athletes) {
      if (!want.has(id) || !list.some((r) => r.status === "done")) continue;
      const s = summarize(state.reps, list);
      out[id] = { workoutId: w._id, date: w.date, repMs: list.map((r) => (r.status === "done" ? r.elapsedMs : null)), avgPaceMsPerKm: s.avgPaceMsPerKm, avgDeltaMs: s.avgDeltaMs };
      want.delete(id);
    }
  }
  return out;
}
