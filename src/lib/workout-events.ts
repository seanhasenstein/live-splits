import "server-only";
import { z } from "zod";
import { getSession, canUseWorkouts, sessionActor } from "@/lib/auth/session";
import { getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import { type Workout, WorkoutEventType } from "@/lib/db/schema";

/** What a device sends for one event; the server stamps the rest. */
export const WorkoutEventInput = z.object({
  clientEventId: z.string().min(1).max(100),
  workoutId: z.string().min(1),
  type: WorkoutEventType,
  groupId: z.string().min(1).nullable(),
  athleteId: z.string().min(1).nullable(),
  repId: z.string().min(1).nullable(),
  targetEventId: z.string().min(1).nullable(),
  deviceTimeMs: z.int().positive(),
  clockOffsetMs: z.int(),
  timeMs: z.int().positive().nullable(),
  note: z.string().max(500).nullable(),
});
export type WorkoutEventInput = z.infer<typeof WorkoutEventInput>;

/** Who may time a workout: a school coach, or a manager who joined with the team's workout code. */
export async function canTimeWorkout(workout: Workout) {
  const session = await getSession();
  return canUseWorkouts(session) && session!.schoolId === workout.schoolId ? session! : null;
}

/**
 * Once a coach ends a workout only fixes go in: a typed time, an edit, an undo, a note, and marking
 * runners (done for today, skipped, back in) after the fact. Reopen it to run more reps.
 */
const allowedWhenEnded = (e: WorkoutEventInput) =>
  ["edit", "void", "note", "time", "stop", "skip", "rejoin"].includes(e.type) || (e.type === "finish" && e.timeMs !== null);

/** A typed rep time names a runner and a rep, and is a believable rep (under two hours). */
const typedTimeOk = (e: WorkoutEventInput) => e.type !== "time" || (e.athleteId !== null && e.repId !== null && e.timeMs !== null && e.timeMs < 2 * 3_600_000);

/** A lap is a group's time on a rep, not yet anyone's. */
const lapOk = (e: WorkoutEventInput) => e.type !== "lap" || (e.groupId !== null && e.repId !== null && e.athleteId === null);

/**
 * Store events; retries are safe (clientEventId is unique). Returns the ids now stored, and the
 * ids refused (they can never be stored, so the phone drops them rather than resending forever).
 * Each event must fit this workout: its rep, group and runner (in the workout or on the
 * season's roster, for a late arrival), and the event it corrects (in this workout).
 */
export async function recordWorkoutEvents(workout: Workout, inputs: WorkoutEventInput[], actor: ReturnType<typeof sessionActor>): Promise<{ accepted: string[]; rejected: string[] }> {
  const db = await getDb();
  const events = collection(db, "workoutEvents");
  const reps = new Set(workout.sets.flatMap((s) => s.reps.map((r) => r.id)));
  const groups = new Set(workout.groups.map((g) => g.id));
  const athletes = new Set(workout.athletes.map((a) => a.athleteId));
  if (inputs.some((e) => e.athleteId !== null && !athletes.has(e.athleteId))) {
    for (const r of await collection(db, "seasonRosters").find({ seasonId: workout.seasonId, deletedAt: null }, { projection: { athleteId: 1 } }).toArray()) athletes.add(r.athleteId);
  }
  // The events these correct or name, from this batch or already stored: an edit or void must point into
  // this workout; an edit to a typed time is a rep time too; a finish naming a Finish needs one on its group and rep.
  type Target = { type: string; groupId: string | null; repId: string | null };
  const targets = new Map<string, Target>(inputs.map((e) => [e.clientEventId, { type: e.type, groupId: e.groupId, repId: e.repId }]));
  const wanted = [...new Set(inputs.map((e) => e.targetEventId).filter((t): t is string => t !== null && !targets.has(t)))];
  if (wanted.length) {
    for (const e of await events.find({ workoutId: workout._id, clientEventId: { $in: wanted } }, { projection: { clientEventId: 1, type: 1, groupId: 1, repId: 1 } }).toArray()) {
      targets.set(e.clientEventId, { type: e.type, groupId: e.groupId, repId: e.repId });
    }
  }
  const targetOk = (e: WorkoutEventInput) => {
    if (e.targetEventId === null) return true;
    const t = targets.get(e.targetEventId);
    if (!t) return false;
    if (e.type === "edit" && t.type === "time") return e.timeMs !== null && e.timeMs < 2 * 3_600_000;
    if (e.type === "finish") return t.type === "lap" && t.groupId === e.groupId && t.repId === e.repId;
    return true;
  };
  // A typed time is for a runner in the workout: planned, or moved in during it (a late arrival).
  const inWorkout = new Set(workout.athletes.map((a) => a.athleteId));
  const typedFor = [...new Set(inputs.filter((e) => e.type === "time" && e.athleteId && !inWorkout.has(e.athleteId)).map((e) => e.athleteId!))];
  if (typedFor.length) {
    for (const e of inputs) if (e.type === "move" && e.athleteId) inWorkout.add(e.athleteId);
    for (const e of await events.find({ workoutId: workout._id, type: "move", athleteId: { $in: typedFor } }, { projection: { athleteId: 1 } }).toArray()) inWorkout.add(e.athleteId!);
  }
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const e of inputs) {
    const fits =
      e.workoutId === workout._id &&
      (e.repId === null || reps.has(e.repId)) &&
      (e.groupId === null || groups.has(e.groupId)) &&
      (e.athleteId === null || athletes.has(e.athleteId)) &&
      targetOk(e) &&
      (e.type !== "time" || inWorkout.has(e.athleteId!)) &&
      typedTimeOk(e) &&
      lapOk(e) &&
      (!workout.finishedAt || allowedWhenEnded(e));
    if (!fits) {
      rejected.push(e.clientEventId);
      continue;
    }
    const doc = COLLECTIONS.workoutEvents.schema.parse({
      _id: newId(),
      schoolId: workout.schoolId,
      schemaVersion: COLLECTIONS.workoutEvents.version,
      ...e,
      serverTimeMs: e.deviceTimeMs + e.clockOffsetMs,
      createdAt: new Date(),
      createdBy: actor,
    });
    try {
      await events.insertOne(doc);
    } catch (err) {
      if (!(err && typeof err === "object" && "code" in err && err.code === 11000)) throw err;
      // Already stored by an earlier attempt: a success, as long as it's this workout's.
      const existing = await events.findOne({ clientEventId: e.clientEventId }, { projection: { workoutId: 1 } });
      if (existing?.workoutId !== workout._id) {
        rejected.push(e.clientEventId);
        continue;
      }
    }
    accepted.push(e.clientEventId);
  }
  return { accepted, rejected };
}
