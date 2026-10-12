"use server";

import { redirect } from "next/navigation";
import { getSession, isSchoolCoach, sessionActor } from "@/lib/auth/session";
import { getProgram, getSchool, getSeasonFor, listAthletes } from "@/lib/data";
import { getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import { expandSets, WorkoutPayload } from "@/lib/workout-plan";
import { getWorkout } from "@/lib/workouts";

/** Create (workoutId null) or update a workout's plan, groups and goals. Coaches only. */
export async function saveWorkoutAction(workoutId: string | null, payloadJson: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return { error: "Only a coach can plan workouts" };
  let json: unknown;
  try {
    json = JSON.parse(payloadJson);
  } catch {
    return { error: "Invalid form" };
  }
  const parsed = WorkoutPayload.safeParse(json);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid form" };
  const input = parsed.data;

  const schoolId = session!.schoolId;
  const [school, program] = await Promise.all([getSchool(schoolId), getProgram(schoolId, "xc")]);
  const season = program && (await getSeasonFor(program._id, input.date));
  if (!school || !program || !season) return { error: "No XC season covers that date" };

  const groupIds = new Set(input.groups.map((g) => g.id));
  if (groupIds.size !== input.groups.length) return { error: "Two groups share an id" };
  if (!input.athletes.every((a) => groupIds.has(a.groupId))) return { error: "An athlete is in a group that doesn't exist" };
  const ids = input.athletes.map((a) => a.athleteId);
  if (new Set(ids).size !== ids.length) return { error: "An athlete is listed twice" };
  if ((await listAthletes(schoolId, ids)).length !== ids.length) return { error: "Unknown athlete" };

  const db = await getDb();
  const now = new Date();
  const actor = sessionActor(session!);
  const fields = {
    seasonId: season._id,
    name: input.name,
    date: input.date,
    timeZone: school.settings.timeZone,
    place: input.place || null,
    approximateDistances: input.approximateDistances,
    effort: input.effort,
    sets: expandSets(input.sets, newId),
    groups: input.groups,
    athletes: input.athletes,
    notes: input.notes || null,
  };

  if (workoutId) {
    const existing = await getWorkout(workoutId);
    if (!existing || existing.schoolId !== schoolId) return { error: "Workout not found" };
    const next = COLLECTIONS.workouts.schema.parse({ ...existing, ...fields, updatedAt: now, updatedBy: actor });
    await collection(db, "workouts").replaceOne({ _id: existing._id }, next);
    redirect(`/workouts/${existing._id}`);
  }
  const workout = COLLECTIONS.workouts.schema.parse({
    _id: newId(),
    schoolId,
    schemaVersion: COLLECTIONS.workouts.version,
    programId: program._id,
    ...fields,
    visibility: "staff",
    finishedAt: null,
    templateId: null,
    source: "manual",
    createdAt: now,
    createdBy: actor,
    updatedAt: now,
    updatedBy: actor,
    deletedAt: null,
  });
  await collection(db, "workouts").insertOne(workout);
  redirect(`/workouts/${workout._id}`);
}

export async function deleteWorkoutAction(workoutId: string): Promise<void> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return;
  const workout = await getWorkout(workoutId);
  if (!workout || workout.schoolId !== session!.schoolId) return;
  await collection(await getDb(), "workouts").updateOne({ _id: workout._id }, { $set: { deletedAt: new Date(), updatedAt: new Date(), updatedBy: sessionActor(session!) } });
  redirect("/workouts");
}
