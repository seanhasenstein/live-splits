import "server-only";
import { z } from "zod";
import { getSession, isSchoolCoach, sessionActor } from "@/lib/auth/session";
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

/** Who may time a workout: for now, a school coach session. Manager access by code comes with the record screen's sharing. */
export async function canTimeWorkout(workout: Workout) {
  const session = await getSession();
  return isSchoolCoach(session) && session!.schoolId === workout.schoolId ? session! : null;
}

/** Store events; retries are safe (clientEventId is unique). Returns the ids now stored. */
export async function recordWorkoutEvents(workout: Workout, inputs: WorkoutEventInput[], actor: ReturnType<typeof sessionActor>): Promise<string[]> {
  const db = await getDb();
  const reps = new Set(workout.sets.flatMap((s) => s.reps.map((r) => r.id)));
  const groups = new Set(workout.groups.map((g) => g.id));
  const accepted: string[] = [];
  for (const e of inputs) {
    if (e.workoutId !== workout._id) continue;
    if (e.repId !== null && !reps.has(e.repId)) continue;
    if (e.groupId !== null && !groups.has(e.groupId)) continue;
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
      await collection(db, "workoutEvents").insertOne(doc);
    } catch (err) {
      // Already stored by an earlier attempt: that's a success.
      if (!(err && typeof err === "object" && "code" in err && err.code === 11000)) throw err;
    }
    accepted.push(e.clientEventId);
  }
  return accepted;
}
