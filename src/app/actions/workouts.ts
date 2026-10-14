"use server";

import { redirect } from "next/navigation";
import { encrypt, formatCode, generateCode, hashCode } from "@/lib/auth/crypto";
import { getSession, isSchoolCoach, sessionActor } from "@/lib/auth/session";
import { getProgram, getSchool, getSeasonFor, listAthletes } from "@/lib/data";
import { getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import { canTimeWorkout } from "@/lib/workout-events";
import { addRepAtEnd, dropLastRep, expandSets, WorkoutPayload } from "@/lib/workout-plan";
import type { Workout } from "@/lib/db/schema";
import { flagCounts, getWorkout } from "@/lib/workouts";

/**
 * What an edit would break once times are in: a rep, group or runner with times taken out, or a
 * runner with times put in a different group (their past reps would re-time against the new
 * group's starts; a move from the record screen is the way). Null when the edit is safe.
 */
async function editConflict(existing: Workout, sets: Workout["sets"], input: WorkoutPayload): Promise<string | null> {
  const events = await collection(await getDb(), "workoutEvents").find({ workoutId: existing._id }, { projection: { clientEventId: 1, type: 1, repId: 1, groupId: 1, athleteId: 1, targetEventId: 1 } }).toArray();
  const voided = new Set(events.filter((e) => e.type === "void").map((e) => e.targetEventId));
  const live = events.filter((e) => e.type !== "void" && e.type !== "edit" && !voided.has(e.clientEventId));
  if (live.length === 0) return null;
  const repIds = new Set(sets.flatMap((s) => s.reps.map((r) => r.id)));
  const oldReps = existing.sets.flatMap((s) => s.reps.map((r) => r.id));
  const lostRep = live.find((e) => e.repId && oldReps.includes(e.repId) && !repIds.has(e.repId));
  if (lostRep) return `Rep ${oldReps.indexOf(lostRep.repId!) + 1} already has times, so it can't be taken out. To stop a group early, end it from the record screen.`;
  const groupIds = new Set(input.groups.map((g) => g.id));
  if (live.some((e) => e.groupId && !groupIds.has(e.groupId))) return "A group with times can't be removed.";
  const newGroup = new Map(input.athletes.map((a) => [a.athleteId, a.groupId]));
  const timed = new Set(live.map((e) => e.athleteId).filter((id): id is string => id !== null));
  for (const a of existing.athletes) {
    if (!timed.has(a.athleteId)) continue;
    if (!newGroup.has(a.athleteId)) return "A runner with times can't be taken out of the workout. Mark them done for today instead.";
    if (newGroup.get(a.athleteId) !== a.groupId) return "A runner with times can't change group here (their earlier reps would be re-timed). Move them from the record screen.";
  }
  // Group starts time everyone in the group, so a group that has run can't lose or swap its runners either way.
  return null;
}

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
  // Guests are checked against the workout's own guest list; everyone else must be a real athlete.
  const guestIds = new Set(input.guests.map((g) => g.id));
  if (guestIds.size !== input.guests.length) return { error: "A guest is listed twice" };
  const athleteIds = ids.filter((id) => !guestIds.has(id));
  if ((await listAthletes(schoolId, athleteIds)).length !== athleteIds.length) return { error: "Unknown athlete" };

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
      approximateDistances: input.surface !== "track",
      surface: input.surface,
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
    approximateDistances: input.surface !== "track",
    surface: input.surface,
    conditions: input.conditions,
    effort: input.effort,
    sets: expandSets(input.sets, newId),
    groups: input.groups,
    athletes: input.athletes,
    guests: input.guests,
    notes: input.notes || null,
  };

  if (workoutId) {
    const existing = await getWorkout(workoutId);
    if (!existing || existing.schoolId !== schoolId) return { error: "Workout not found" };
    if (input.expectedUpdatedAt !== undefined && existing.updatedAt.getTime() !== input.expectedUpdatedAt) {
      return { error: "The workout changed while you were editing (a rep added at the track?). Reload the page and make your changes again." };
    }
    const conflict = await editConflict(existing, fields.sets, input);
    if (conflict) return { error: conflict };
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
  if (workout.finishedAt) return { error: "The workout has been ended. Reopen it to change the reps." };
  const db = await getDb();
  // Read, change, write only if nobody changed it meanwhile (two phones tapping "add" add two); retry on a clash.
  for (let attempt = 0, current = workout; attempt < 3; attempt++) {
    let sets = current.sets;
    if (change === "add") sets = addRepAtEnd(sets);
    else {
      const lastId = sets.at(-1)!.reps.at(-1)!.id;
      const events = await collection(db, "workoutEvents").find({ workoutId: workout._id, repId: lastId }, { projection: { clientEventId: 1, type: 1 } }).toArray();
      const voids = await collection(db, "workoutEvents").find({ workoutId: workout._id, type: "void" }, { projection: { targetEventId: 1 } }).toArray();
      const voided = new Set(voids.map((e) => e.targetEventId));
      // Anything recorded on it (a start, a time typed in, a skip or done-for-today, a note) keeps it:
      // dropped, those would vanish, and come back on whatever rep is added next under the same id.
      if (events.some((e) => !voided.has(e.clientEventId))) return { error: "That rep already has times or marks on it" };
      const fewer = dropLastRep(sets);
      if (!fewer) return { error: "It's the only rep" };
      sets = fewer;
    }
    const r = await collection(db, "workouts").updateOne({ _id: workout._id, updatedAt: current.updatedAt }, { $set: { sets, updatedAt: new Date(), updatedBy: sessionActor(session) } });
    if (r.matchedCount === 1) return {};
    const fresh = await getWorkout(workoutId);
    if (!fresh) return { error: "Workout not found" };
    current = fresh;
  }
  return { error: "The plan was changing on another phone. Try again." };
}

/** How many times are flagged to check on a workout right now (for End workout's reminder). */
export async function flagCountAction(workoutId: string): Promise<number> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return 0;
  const workout = await getWorkout(workoutId);
  if (!workout || workout.schoolId !== session!.schoolId) return 0;
  return (await flagCounts([workout._id])).get(workout._id) ?? 0;
}

/**
 * Add a guest runner mid-practice (a visiting middle schooler): a name on this workout only. Whoever is
 * timing can; the phone then joins them to its group from the current rep, like a late arrival.
 */
export async function addGuestAction(workoutId: string, name: string): Promise<{ error?: string; id?: string }> {
  const workout = await getWorkout(workoutId);
  if (!workout) return { error: "Workout not found" };
  const session = await canTimeWorkout(workout);
  if (!session) return { error: "Not allowed" };
  const clean = name.trim().slice(0, 40);
  if (!clean) return { error: "Give the guest a name" };
  const id = `guest_${newId()}`;
  await collection(await getDb(), "workouts").updateOne(
    { _id: workout._id },
    { $push: { guests: { id, name: clean } }, $set: { updatedAt: new Date(), updatedBy: sessionActor(session) } },
  );
  return { id };
}
