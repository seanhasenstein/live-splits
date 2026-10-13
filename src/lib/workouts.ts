import "server-only";
import type { Condition, Surface, Workout, WorkoutEvent, WorkoutTemplate } from "@/lib/db/schema";
import { listAthletes, listRoster, type RosterAthlete } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { describePlan, surfaceOf } from "@/lib/workout-plan";
import { replayWorkout, summarize } from "@/lib/workout-replay";

/** Fields added after the first workouts were saved: reads fill them in, as the schema's defaults would. */
const withDefaults = (w: Workout): Workout => ({ ...w, surface: w.surface ?? null, conditions: w.conditions ?? [] });

export async function listWorkouts(schoolId: string): Promise<Workout[]> {
  return (await collection(await getDb(), "workouts").find({ schoolId, deletedAt: null }).sort({ date: -1, createdAt: -1 }).toArray()).map(withDefaults);
}

export async function listTemplates(schoolId: string, programId: string): Promise<WorkoutTemplate[]> {
  return (await collection(await getDb(), "workoutTemplates").find({ schoolId, programId, deletedAt: null }).sort({ name: 1 }).toArray()).map((t) => ({ ...t, surface: t.surface ?? null }));
}

export async function getWorkout(id: string): Promise<Workout | null> {
  const w = await collection(await getDb(), "workouts").findOne({ _id: id, deletedAt: null });
  return w && withDefaults(w);
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
  /** Where and how it was run then (a track day and a muddy grass day don't compare straight). */
  surface: Surface;
  conditions: Condition[];
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
      .project<Pick<Workout, "_id" | "date" | "createdAt" | "sets" | "groups" | "athletes" | "approximateDistances" | "surface" | "conditions">>({ _id: 1, date: 1, createdAt: 1, sets: 1, groups: 1, athletes: 1, approximateDistances: 1, surface: 1, conditions: 1 })
      .toArray()
  )
    .filter((w) => describePlan(w.sets) === signature && (w.date < workout.date || w.createdAt < workout.createdAt))
    .slice(0, 8);
  const out: Record<string, LastTime> = {};
  const want = new Set(workout.athletes.map((a) => a.athleteId));
  if (earlier.length === 0) return out;
  // One query for every candidate's log, grouped here.
  const byWorkout = new Map<string, WorkoutEvent[]>();
  for (const e of await collection(db, "workoutEvents").find({ workoutId: { $in: earlier.map((w) => w._id) } }).toArray()) {
    byWorkout.set(e.workoutId, [...(byWorkout.get(e.workoutId) ?? []), e]);
  }
  // Newest first; stop once everyone has one.
  for (const w of earlier) {
    if (want.size === 0) break;
    const state = replayWorkout(w, byWorkout.get(w._id) ?? []);
    for (const [id, list] of state.athletes) {
      if (!want.has(id) || !list.some((r) => r.status === "done")) continue;
      const s = summarize(state.reps, list);
      out[id] = { workoutId: w._id, date: w.date, surface: surfaceOf(w), conditions: w.conditions ?? [], repMs: list.map((r) => (r.status === "done" ? r.elapsedMs : null)), avgPaceMsPerKm: s.avgPaceMsPerKm, avgDeltaMs: s.avgDeltaMs };
      want.delete(id);
    }
  }
  return out;
}

/** How many times are flagged to check, per workout (a flag counts until it's voided: "checked"). */
export async function flagCounts(workoutIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (workoutIds.length === 0) return out;
  const events = collection(await getDb(), "workoutEvents");
  // The flags, then only the voids aimed at them (not every Undo of every workout on the list).
  const flags = await events.find({ workoutId: { $in: workoutIds }, type: "flag" }, { projection: { clientEventId: 1, workoutId: 1, athleteId: 1, repId: 1 } }).toArray();
  if (flags.length === 0) return out;
  const voided = new Set(
    (await events.find({ workoutId: { $in: [...new Set(flags.map((f) => f.workoutId))] }, type: "void", targetEventId: { $in: flags.map((f) => f.clientEventId) } }, { projection: { targetEventId: 1 } }).toArray()).map((e) => e.targetEventId),
  );
  const open = new Map<string, Set<string>>(); // workout -> runner:rep with a live flag
  for (const e of flags) {
    if (voided.has(e.clientEventId)) continue;
    if (!open.has(e.workoutId)) open.set(e.workoutId, new Set());
    open.get(e.workoutId)!.add(`${e.athleteId}:${e.repId}`);
  }
  for (const [id, keys] of open) out.set(id, keys.size);
  return out;
}

/**
 * Everyone a workout's screens need a name for: the season's roster, plus anyone in the workout who has
 * since come off it (their times still need their name, not "?").
 */
export async function workoutPeople(workout: Workout): Promise<RosterAthlete[]> {
  const roster = await listRoster(workout.seasonId);
  const onRoster = new Set(roster.map((a) => a._id));
  const missing = workout.athletes.map((a) => a.athleteId).filter((id) => !onRoster.has(id));
  const extra = missing.length ? await listAthletes(workout.schoolId, missing) : [];
  return [...roster, ...extra.map((a) => ({ ...a, defaultLevelId: "" }))];
}
