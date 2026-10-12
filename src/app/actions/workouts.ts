"use server";

import { redirect } from "next/navigation";
import { encrypt, formatCode, generateCode, hashCode } from "@/lib/auth/crypto";
import { getSession, isSchoolCoach, sessionActor } from "@/lib/auth/session";
import { getProgram, getSchool, getSeasonFor, listAthletes } from "@/lib/data";
import { getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import { canTimeWorkout } from "@/lib/workout-events";
import { addRepAtEnd, dropLastRep, expandSets, WorkoutPayload } from "@/lib/workout-plan";
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
  if (input.saveAsTemplate) {
    // One template per name: saving again under the same name updates it.
    const existing = await collection(db, "workoutTemplates").findOne({ schoolId, programId: program._id, name: input.name, deletedAt: null });
    const template = COLLECTIONS.workoutTemplates.schema.parse({
      _id: existing?._id ?? newId(),
      schoolId,
      schemaVersion: COLLECTIONS.workoutTemplates.version,
      programId: program._id,
      name: input.name,
      effort: input.effort,
      sets: expandSets(input.sets, newId),
      approximateDistances: input.approximateDistances,
      source: "manual",
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? actor,
      updatedAt: now,
      updatedBy: actor,
      deletedAt: null,
    });
    await collection(db, "workoutTemplates").replaceOne({ _id: template._id }, template, { upsert: true });
  }
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
    templateId: input.templateId ?? null,
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

/** End a workout (the clocks stop and the page becomes a summary) or reopen it. Coaches only. */
export async function setWorkoutFinishedAction(workoutId: string, finished: boolean): Promise<{ error?: string }> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return { error: "Only a coach can end a workout" };
  const workout = await getWorkout(workoutId);
  if (!workout || workout.schoolId !== session!.schoolId) return { error: "Workout not found" };
  await collection(await getDb(), "workouts").updateOne(
    { _id: workout._id },
    { $set: { finishedAt: finished ? new Date() : null, updatedAt: new Date(), updatedBy: sessionActor(session!) } },
  );
  return {};
}

/** Remove a saved template. Workouts made from it keep their reps. */
export async function deleteTemplateAction(templateId: string): Promise<void> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return;
  await collection(await getDb(), "workoutTemplates").updateOne(
    { _id: templateId, schoolId: session!.schoolId, deletedAt: null },
    { $set: { deletedAt: new Date(), updatedAt: new Date(), updatedBy: sessionActor(session!) } },
  );
  redirect("/workouts/new");
}

/**
 * Make (or replace) the team's workout code for managers. Replacing it signs
 * out everyone who joined with the old one. Returns the new code, "ABC-DEF".
 */
export async function regenerateWorkoutCodeAction(): Promise<{ error?: string; code?: string }> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return { error: "Only a coach can change the workout code" };
  const program = await getProgram(session!.schoolId, "xc");
  if (!program) return { error: "No program set up" };
  const code = generateCode();
  const db = await getDb();
  await collection(db, "programs").updateOne(
    { _id: program._id },
    { $set: { workoutCode: { hash: hashCode(code), enc: encrypt(code) }, updatedAt: new Date(), updatedBy: sessionActor(session!) } },
  );
  if (program.workoutCode) {
    await collection(db, "sessions").updateMany({ schoolId: program.schoolId, role: "manager", meetId: null, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }
  return { code: formatCode(code) };
}

/**
 * Add a rep at the end, or drop the last one, mid-workout. Whoever is timing
 * can (a coach's "one more"); a rep any group has started can't be dropped.
 */
export async function changeRepsAction(workoutId: string, change: "add" | "drop"): Promise<{ error?: string }> {
  const workout = await getWorkout(workoutId);
  if (!workout) return { error: "Workout not found" };
  const session = await canTimeWorkout(workout);
  if (!session) return { error: "Not allowed" };
  const db = await getDb();
  let sets = workout.sets;
  if (change === "add") sets = addRepAtEnd(sets);
  else {
    const lastId = sets.at(-1)!.reps.at(-1)!.id;
    const events = await collection(db, "workoutEvents").find({ workoutId: workout._id }, { projection: { clientEventId: 1, type: 1, repId: 1, targetEventId: 1 } }).toArray();
    const voided = new Set(events.filter((e) => e.type === "void").map((e) => e.targetEventId));
    if (events.some((e) => e.repId === lastId && !voided.has(e.clientEventId))) return { error: "A group has already started that rep" };
    const fewer = dropLastRep(sets);
    if (!fewer) return { error: "It's the only rep" };
    sets = fewer;
  }
  await collection(db, "workouts").updateOne({ _id: workout._id }, { $set: { sets, updatedAt: new Date(), updatedBy: sessionActor(session) } });
  return {};
}
