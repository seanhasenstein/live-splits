"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { encrypt, formatCode, generateCode, generateToken, hashCode, hashToken } from "@/lib/auth/crypto";
import { can, getSession, isSchoolCoach, sessionActor } from "@/lib/auth/session";
import { getMeet, getProgram, getSeasonFor } from "@/lib/data";
import { getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import { LocalDate, type Meet, TimeZone } from "@/lib/db/schema";
import { PlaceError, resolvePlace } from "@/lib/places";

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
  shortName: z.string().trim().max(16, "Keep the short name to 16 characters").default(""),
  /** An existing course at the venue, or "new" to create `newCourseName`; blank = the venue's current layout (created if none). */
  courseId: z.string().trim().max(64).default(""),
  newCourseName: z.string().trim().max(120).default(""),
  /** "on" when nothing from this meet should count for PRs / season bests / course bests. */
  recordsExcluded: z.string().optional(),
  recordsExclusionReason: z.string().trim().max(200).default(""),
});

const recordsExclusionOf = (input: { recordsExcluded?: string; recordsExclusionReason: string }) => (input.recordsExcluded ? { reason: input.recordsExclusionReason || null } : null);

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
  let place: { venueId: string | null; courseId: string | null };
  try {
    place = await resolvePlace(db, schoolId, input, actor);
  } catch (err) {
    if (err instanceof PlaceError) return { error: err.message };
    throw err;
  }
  const { venueId, courseId } = place;

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
    shortName: input.shortName || null,
    date: input.date,
    timeZone: input.timeZone,
    weather: null,
    resultsUrl: input.resultsUrl || null,
    recordsExclusion: recordsExclusionOf(input),
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
  let place: { venueId: string | null; courseId: string | null };
  try {
    place = await resolvePlace(db, meet.schoolId, input, actor);
  } catch (err) {
    if (err instanceof PlaceError) return { error: err.message };
    throw err;
  }
  const { venueId, courseId } = place;
  await collection(db, "meets").updateOne(
    { _id: meet._id },
    {
      $set: {
        name: input.name,
        shortName: input.shortName || null,
        date: input.date,
        timeZone: input.timeZone,
        seasonId: season._id,
        venueId,
        courseId,
        resultsUrl: input.resultsUrl || null,
        recordsExclusion: recordsExclusionOf(input),
        updatedAt: new Date(),
        updatedBy: actor,
      },
    },
  );
  redirect(`/meets/${meet._id}`);
}

/** Create (or replace) the season-wide viewer link. Replacing signs out everyone using the old one. */
export async function regenerateSeasonLinkAction(): Promise<{ error?: string; viewerPath?: string }> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return { error: "Not allowed" };
  const token = generateToken();
  const db = await getDb();
  await collection(db, "schools").updateOne(
    { _id: session!.schoolId },
    { $set: { viewerLink: { tokenHash: hashToken(token), tokenEnc: encrypt(token) }, updatedAt: new Date(), updatedBy: sessionActor(session!) } },
  );
  // Sessions opened with the old link stop here.
  await collection(db, "sessions").updateMany({ schoolId: session!.schoolId, meetId: null, role: "viewer", revokedAt: null }, { $set: { revokedAt: new Date() } });
  return { viewerPath: `/v/${token}` };
}
