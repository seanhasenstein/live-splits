"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { encrypt, formatCode, generateCode, generateToken, hashCode, hashToken } from "@/lib/auth/crypto";
import { can, getSession, isSchoolCoach, sessionActor } from "@/lib/auth/session";
import { getMeet, getProgram, getSeasonFor } from "@/lib/data";
import type { Db } from "mongodb";
import { getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import { type Actor, LocalDate, type Meet, TimeZone } from "@/lib/db/schema";

export type JoinCodes = { managerCode: string; coachCode: string; viewerPath: string };
export type MeetFormState = { error?: string; created?: { meetId: string; codes: JoinCodes } };
export type CodesState = { error?: string; codes?: JoinCodes };

function newJoinCodes(): { codes: JoinCodes; hashes: Meet["joinCodes"] } {
  const managerCode = generateCode();
  const coachCode = generateCode();
  const viewerToken = generateToken();
  return {
    codes: {
      managerCode: formatCode(managerCode),
      coachCode: formatCode(coachCode),
      viewerPath: `/v/${viewerToken}`,
    },
    hashes: {
      managerCodeHash: hashCode(managerCode),
      coachCodeHash: hashCode(coachCode),
      viewerTokenHash: hashToken(viewerToken),
      managerCodeEnc: encrypt(managerCode),
      coachCodeEnc: encrypt(coachCode),
      viewerTokenEnc: encrypt(viewerToken),
    },
  };
}

const MeetForm = z.object({
  name: z.string().trim().min(1, "Enter a meet name").max(120),
  date: LocalDate,
  timeZone: TimeZone,
  venueName: z.string().trim().max(120),
  venueCity: z.string().trim().max(80),
  venueState: z.string().trim().toUpperCase().max(2),
  resultsUrl: z
    .string()
    .trim()
    .max(500)
    .default("")
    .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
    .pipe(z.union([z.literal(""), z.url("That results link doesn't look like a web address")])),
  /** An existing course at the venue, or "new" to create `newCourseName`; blank = the venue's current layout (created if none). */
  courseId: z.string().trim().max(64).default(""),
  newCourseName: z.string().trim().max(120).default(""),
});
type MeetInput = z.infer<typeof MeetForm>;

/**
 * Venue and course for a meet. The venue is matched by name (created if new).
 * Every meet gets a course: the one the coach picked, a new layout they
 * named, or the venue's current layout, created on the spot and named after
 * the venue so course records work from the first meet without anyone
 * having to think about it.
 */
async function resolvePlace(db: Db, schoolId: string, input: MeetInput, actor: Actor): Promise<{ venueId: string | null; courseId: string | null }> {
  if (!input.venueName) return { venueId: null, courseId: null };
  const now = new Date();
  const audit = { source: "manual" as const, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, deletedAt: null };
  const year = Number(input.date.slice(0, 4));

  const venues = collection(db, "venues");
  let venueId = (await venues.findOne({ schoolId, name: input.venueName, deletedAt: null }))?._id ?? null;
  if (!venueId) {
    const venue = COLLECTIONS.venues.schema.parse({
      _id: newId(),
      schoolId,
      schemaVersion: COLLECTIONS.venues.version,
      name: input.venueName,
      city: input.venueCity || null,
      state: input.venueState || null,
      notes: null,
      ...audit,
    });
    await venues.insertOne(venue);
    venueId = venue._id;
  }

  const courses = collection(db, "courses");
  if (input.courseId && input.courseId !== "new") {
    const picked = await courses.findOne({ _id: input.courseId, venueId, deletedAt: null });
    if (picked) return { venueId, courseId: picked._id };
  }
  if (input.courseId !== "new") {
    // The venue's current layout: the open course that started most recently.
    const current = await courses.find({ venueId, deletedAt: null, $or: [{ activeToYear: null }, { activeToYear: { $gte: year } }] }).sort({ activeFromYear: -1 }).limit(1).next();
    if (current) return { venueId, courseId: current._id };
  }
  const course = COLLECTIONS.courses.schema.parse({
    _id: newId(),
    schoolId,
    schemaVersion: COLLECTIONS.courses.version,
    venueId,
    name: input.courseId === "new" && input.newCourseName ? input.newCourseName : input.venueName,
    sport: "xc",
    typicalMeasuredDistance: null,
    activeFromYear: year,
    activeToYear: null,
    notes: null,
    ...audit,
  });
  await courses.insertOne(course);
  return { venueId, courseId: course._id };
}

export async function createMeetAction(_prev: MeetFormState, formData: FormData): Promise<MeetFormState> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return { error: "Only a coach session can create meets" };
  const parsed = MeetForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  const schoolId = session!.schoolId;
  const program = await getProgram(schoolId, "xc");
  const season = program && (await getSeasonFor(program._id, input.date));
  if (!program || !season) return { error: "No XC program/season is set up" };

  const db = await getDb();
  const now = new Date();
  const actor = sessionActor(session!);
  const audit = { source: "manual", createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, deletedAt: null };
  const { venueId, courseId } = await resolvePlace(db, schoolId, input, actor);

  const { codes, hashes } = newJoinCodes();
  const meet = COLLECTIONS.meets.schema.parse({
    _id: newId(),
    schoolId,
    schemaVersion: COLLECTIONS.meets.version,
    programId: program._id,
    seasonId: season._id,
    meetSeriesId: null,
    venueId,
    courseId,
    name: input.name,
    date: input.date,
    timeZone: input.timeZone,
    weather: null,
    resultsUrl: input.resultsUrl || null,
    joinCodes: hashes,
    ...audit,
  });
  await collection(db, "meets").insertOne(meet);
  return { created: { meetId: meet._id, codes } };
}

export async function regenerateCodesAction(meetId: string): Promise<CodesState> {
  const session = await getSession();
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "setup", meet)) return { error: "Not allowed" };
  const { codes, hashes } = newJoinCodes();
  await collection(await getDb(), "meets").updateOne(
    { _id: meet._id },
    { $set: { joinCodes: hashes, updatedAt: new Date(), updatedBy: sessionActor(session!) } },
  );
  return { codes };
}

export async function deleteMeetAction(meetId: string): Promise<void> {
  const session = await getSession();
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "setup", meet)) throw new Error("Not allowed");
  await collection(await getDb(), "meets").updateOne(
    { _id: meet._id },
    { $set: { deletedAt: new Date(), updatedAt: new Date(), updatedBy: sessionActor(session!) } },
  );
  redirect("/meets");
}

/** Edit a meet's name, date, zone, venue and course. Races and the log are untouched. */
export async function updateMeetAction(meetId: string, _prev: MeetFormState, formData: FormData): Promise<MeetFormState> {
  const session = await getSession();
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "setup", meet)) return { error: "Not allowed" };
  const parsed = MeetForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;
  const program = await getProgram(meet.schoolId, "xc");
  const season = program && (await getSeasonFor(program._id, input.date));
  if (!program || !season) return { error: "No season covers that date" };

  const db = await getDb();
  const actor = sessionActor(session!);
  const { venueId, courseId } = await resolvePlace(db, meet.schoolId, input, actor);
  await collection(db, "meets").updateOne(
    { _id: meet._id },
    {
      $set: { name: input.name, date: input.date, timeZone: input.timeZone, seasonId: season._id, venueId, courseId, resultsUrl: input.resultsUrl || null, updatedAt: new Date(), updatedBy: actor },
    },
  );
  redirect(`/meets/${meet._id}`);
}
