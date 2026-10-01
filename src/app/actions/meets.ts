"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { formatCode, generateCode, generateToken, hashCode, hashToken } from "@/lib/auth/crypto";
import { can, getSession, isSchoolCoach, sessionActor } from "@/lib/auth/session";
import { getMeet, getProgram, getSeasonFor } from "@/lib/data";
import { getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import { LocalDate, type Meet, TimeZone } from "@/lib/db/schema";

/** Plaintext codes exist only in this response; only hashes are stored. */
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
});

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

  let venueId: string | null = null;
  if (input.venueName) {
    const venues = collection(db, "venues");
    const existing = await venues.findOne({ schoolId, name: input.venueName, deletedAt: null });
    if (existing) venueId = existing._id;
    else {
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
  }

  const { codes, hashes } = newJoinCodes();
  const meet = COLLECTIONS.meets.schema.parse({
    _id: newId(),
    schoolId,
    schemaVersion: COLLECTIONS.meets.version,
    programId: program._id,
    seasonId: season._id,
    meetSeriesId: null,
    venueId,
    courseId: null,
    name: input.name,
    date: input.date,
    timeZone: input.timeZone,
    weather: null,
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
