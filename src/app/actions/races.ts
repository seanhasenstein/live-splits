"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { generateCode } from "@/lib/auth/crypto";
import { can, getSession, sessionActor } from "@/lib/auth/session";
import { getMeet, getProgram, getRace, listAthletes, listDistances } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import { newId } from "@/lib/db/client";
import { Id } from "@/lib/db/schema";
import { RacePayload } from "@/lib/race-form";
import { distanceValue } from "@/lib/distance";
import { recordTaps, TapError } from "@/lib/taps";
import { zonedTimeToEpochMs } from "@/lib/time";

export type FormState = { error?: string };


export async function saveRaceAction(
  meetId: string,
  raceId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "setup", meet)) return { error: "Not allowed" };

  let payload: RacePayload;
  try {
    payload = RacePayload.parse(JSON.parse(String(formData.get("payload") ?? "")));
  } catch (err) {
    return { error: err instanceof z.ZodError ? err.issues[0].message : "Invalid form" };
  }

  const program = await getProgram(meet.schoolId, "xc");
  if (!program) return { error: "No XC program" };
  const { levels, raceCategories } = program.settings;
  if (!raceCategories.some((c) => c.id === payload.raceCategoryId)) return { error: "Unknown race category" };
  if (!payload.levelIds.every((l) => levels.some((x) => x.id === l))) return { error: "Unknown level" };
  if (!(await listDistances("xc")).some((d) => d._id === payload.distanceId)) return { error: "Unknown distance" };
  if (payload.checkpoints.filter((c) => c.kind === "finish").length > 1) return { error: "Only one finish checkpoint" };

  const athleteIds = payload.lineup.map((l) => l.athleteId);
  if (new Set(athleteIds).size !== athleteIds.length) return { error: "An athlete is listed twice" };
  const known = await listAthletes(meet.schoolId, athleteIds);
  if (known.length !== athleteIds.length) return { error: "Unknown athlete in lineup" };
  if (!payload.lineup.every((l) => payload.levelIds.includes(l.levelId))) {
    return { error: "Every athlete's level must be one of the race's levels" };
  }

  const checkpoints = payload.checkpoints
    .map((c) => ({
      id: c.id ?? `cp-${generateCode(6).toLowerCase()}`,
      label: c.label,
      distance: distanceValue(c.value, c.unit),
      kind: c.kind,
    }))
    .sort((a, b) => a.distance.meters - b.distance.meters);

  const db = await getDb();
  const races = collection(db, "races");
  const now = new Date();
  const actor = sessionActor(session!);
  const fields = {
    name: payload.name,
    raceCategoryId: payload.raceCategoryId,
    levelIds: payload.levelIds,
    distanceId: payload.distanceId,
    scheduledStart: payload.scheduledStart,
    checkpoints,
    lineup: payload.lineup,
  };

  if (raceId) {
    const race = await getRace(raceId);
    if (!race || race.meetId !== meet._id) return { error: "Race not found" };
    const next = COLLECTIONS.races.schema.parse({ ...race, finishedAt: race.finishedAt ?? null, ...fields, updatedAt: now, updatedBy: actor });
    await races.replaceOne({ _id: race._id }, next);
  } else {
    const order = await races.countDocuments({ meetId: meet._id, deletedAt: null });
    const race = COLLECTIONS.races.schema.parse({
      _id: newId(),
      schoolId: meet.schoolId,
      schemaVersion: COLLECTIONS.races.version,
      meetId: meet._id,
      order,
      eventKind: "run",
      measuredDistance: null,
      gunTimeMs: null,
      gunTimeSource: null,
      finishedAt: null,
      sections: [],
      teamScoring: [],
      exclusions: {
        excludeFromPrSb: false,
        excludeFromCourseLists: false,
        excludeFromMeetLists: false,
        exclusionReason: null,
      },
      ...fields,
      source: "manual",
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
      deletedAt: null,
    });
    await races.insertOne(race);
  }
  redirect(`/meets/${meet._id}`);
}

export async function deleteRaceAction(raceId: string): Promise<void> {
  const session = await getSession();
  const race = await getRace(raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet || !can(session, "setup", meet)) throw new Error("Not allowed");
  await collection(await getDb(), "races").updateOne(
    { _id: race._id },
    { $set: { deletedAt: new Date(), updatedAt: new Date(), updatedBy: sessionActor(session!) } },
  );
  redirect(`/meets/${meet._id}`);
}

const GunTimeForm = z.object({
  raceId: Id,
  /** Wall-clock time in the meet's zone: "19:10:03" or "19:10:03.4". */
  time: z.string().regex(/^\d{2}:\d{2}:\d{2}(\.\d)?$/, "Use HH:MM:SS or HH:MM:SS.t (24-hour)"),
});

/** Set the gun by typing the wall-clock time it went off. Logged as a manual gun tap. */
export async function setGunTimeAction(raceId: string, time: string): Promise<FormState & { gunTimeMs?: number }> {
  const parsed = GunTimeForm.safeParse({ raceId, time });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const race = await getRace(parsed.data.raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet) return { error: "Race not found" };
  const now = Date.now();
  try {
    const result = await recordTaps(await getSession(), race, meet, [
      {
        clientTapId: `srv-${newId()}`,
        type: "gun",
        raceId: race._id,
        checkpointId: null,
        athleteId: null,
        targetTapId: null,
        deviceTimeMs: now,
        clockOffsetMs: 0,
        timeMs: zonedTimeToEpochMs(meet.date, parsed.data.time, meet.timeZone),
        estimate: false,
        missed: false,
        note: "set by typing the clock time",
      },
    ]);
    return { gunTimeMs: result.race.gunTimeMs ?? undefined };
  } catch (err) {
    if (err instanceof TapError) return { error: err.message };
    throw err;
  }
}

/** Remove the gun time. Logged as a void of the latest gun tap. */
export async function clearGunTimeAction(raceId: string): Promise<FormState> {
  const session = await getSession();
  const race = await getRace(raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet || !can(session, "gun", meet)) return { error: "Not allowed" };
  const db = await getDb();
  const lastGun = await collection(db, "taps").findOne(
    { raceId: race._id, type: "gun" },
    { sort: { createdAt: -1 } },
  );
  const now = Date.now();
  if (lastGun) {
    await recordTaps(session, race, meet, [
      {
        clientTapId: `srv-${newId()}`,
        type: "void",
        raceId: race._id,
        checkpointId: null,
        athleteId: null,
        targetTapId: lastGun.clientTapId,
        deviceTimeMs: now,
        clockOffsetMs: 0,
        timeMs: null,
        estimate: false,
        missed: false,
        note: "gun cleared",
      },
    ]);
  }
  await collection(db, "races").updateOne(
    { _id: race._id },
    { $set: { gunTimeMs: null, gunTimeSource: null, updatedAt: new Date(), updatedBy: sessionActor(session!) } },
  );
  return {};
}

/** Mark a race finished (the clock stops ticking; the board becomes the review screen) or reopen it. */
export async function setRaceFinishedAction(raceId: string, finished: boolean): Promise<FormState> {
  const session = await getSession();
  const race = await getRace(raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet || !can(session, "gun", meet)) return { error: "Not allowed" };
  await collection(await getDb(), "races").updateOne(
    { _id: race._id },
    { $set: { finishedAt: finished ? new Date() : null, updatedAt: new Date(), updatedBy: sessionActor(session!) } },
  );
  return {};
}
