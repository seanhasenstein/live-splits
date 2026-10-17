"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { generateCode } from "@/lib/auth/crypto";
import { can, getSession, sessionActor } from "@/lib/auth/session";
import { getMeet, getProgram, getRace, getSchool, listAthletes, listDistances } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import { newId } from "@/lib/db/client";
import { Id, RacePlaces } from "@/lib/db/schema";
import { teamKey } from "@/lib/race-places";
import { RacePayload } from "@/lib/race-form";
import { distanceValue } from "@/lib/distance";
import { getOfficialTimes, gunFromOfficial } from "@/lib/results/import";
import { fromUrl, isLiveFeedUrl, SourceError } from "@/lib/results/sources";
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

  if (new Set(checkpoints.map((c) => c.id)).size !== checkpoints.length) return { error: "Checkpoint ids must be unique" };

  if (raceId) {
    const race = await getRace(raceId);
    if (!race || race.meetId !== meet._id) return { error: "Race not found" };
    // Recorded times live under checkpoint ids; dropping one would hide them.
    const used = (await collection(db, "taps").distinct("checkpointId", { raceId: race._id })).filter((id): id is string => !!id);
    const kept = new Set(checkpoints.map((c) => c.id));
    const missing = used.filter((id) => !kept.has(id));
    if (missing.length > 0) {
      const labels = missing.map((id) => race.checkpoints.find((c) => c.id === id)?.label ?? id);
      return { error: `${labels.join(", ")} already has recorded times and can't be removed.` };
    }
    const next = COLLECTIONS.races.schema.parse({
      ...race,
      finishedAt: race.finishedAt ?? null,
      officialImportId: race.officialImportId ?? null,
      ...fields,
      updatedAt: now,
      updatedBy: actor,
    });
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
      officialImportId: null,
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
  // No gun means the race is back to not started (a finished flag would strand it) — unless
  // official results are in, in which case it stays finished and just has no app gun.
  await collection(db, "races").updateOne(
    { _id: race._id },
    { $set: { gunTimeMs: null, gunTimeSource: null, ...(race.officialImportId ? {} : { finishedAt: null }), updatedAt: new Date(), updatedBy: sessionActor(session!) } },
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

/** Preview what "set the gun from official results" would do. */
export async function gunFromOfficialPreviewAction(raceId: string): Promise<{ error?: string; gunTimeMs?: number; samples?: number; spreadMs?: number; currentMs?: number | null }> {
  const session = await getSession();
  const race = await getRace(raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet || !can(session, "gun", meet)) return { error: "Not allowed" };
  const est = await gunFromOfficial(race);
  if (!est) return { error: "Needs at least one runner with both an app finish tap and an official finish." };
  return { ...est, currentMs: race.gunTimeMs };
}

/** Set the gun so app splits line up with the official finishes. Logged as a gun tap from official results. */
export async function setGunFromOfficialAction(raceId: string): Promise<FormState & { gunTimeMs?: number }> {
  const session = await getSession();
  const race = await getRace(raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet || !can(session, "gun", meet)) return { error: "Not allowed" };
  const est = await gunFromOfficial(race);
  if (!est) return { error: "Needs at least one runner with both an app finish tap and an official finish." };
  const now = Date.now();
  try {
    const result = await recordTaps(session, race, meet, [
      {
        clientTapId: `srv-${newId()}`,
        type: "gun",
        raceId: race._id,
        checkpointId: null,
        athleteId: null,
        targetTapId: null,
        deviceTimeMs: now,
        clockOffsetMs: 0,
        timeMs: est.gunTimeMs,
        estimate: false,
        missed: false,
        note: `from official results: median of ${est.samples} finishers`,
      },
    ]);
    // With official results the race ended at the last official finish, now that the gun is known.
    const lastFinish = Math.max(0, ...Object.values(await getOfficialTimes(race)).map((o) => o.finishMs ?? 0));
    const finishedAt = race.officialImportId && lastFinish > 0 ? new Date(est.gunTimeMs + lastFinish) : race.finishedAt;
    await collection(await getDb(), "races").updateOne({ _id: race._id }, { $set: { gunTimeSource: "official_results", finishedAt } });
    return { gunTimeMs: result.race.gunTimeMs ?? undefined };
  } catch (err) {
    if (err instanceof TapError) return { error: err.message };
    throw err;
  }
}

export type LiveFeedOption = { name: string; url: string; entries: number };

/** Read a results link and list the contests it offers, so the coach can pick this race's. */
export async function findLiveFeedsAction(raceId: string, url: string): Promise<{ error?: string; options?: LiveFeedOption[] }> {
  const session = await getSession();
  const race = await getRace(raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet || !can(session, "gun", meet)) return { error: "Not allowed" };
  try {
    const contests = await fromUrl(url);
    const seen = new Set<string>();
    const options = contests.flatMap((c) => {
      // XM meet pages list each race under two Arrow links; one is enough.
      const key = `${c.name}|${c.entries.length}`;
      if (!c.source.url || seen.has(key)) return [];
      seen.add(key);
      return [{ name: c.name, url: c.source.url, entries: c.entries.length }];
    });
    if (options.length === 0) return { error: "That link has no live feed the app can poll. Use the timing company's results page or a RACE RESULT contest link." };
    return { options };
  } catch (err) {
    return { error: err instanceof SourceError ? err.message : "Couldn't read that link." };
  }
}

export async function setLiveFeedAction(raceId: string, feed: { url: string; contestName: string | null } | null): Promise<FormState> {
  const session = await getSession();
  const race = await getRace(raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet || !can(session, "gun", meet)) return { error: "Not allowed" };
  const parsed = z.object({ url: z.url(), contestName: z.string().max(200).nullable() }).nullable().safeParse(feed);
  if (!parsed.success) return { error: "That isn't a valid link." };
  // Only feeds the server knows how to read get polled.
  if (parsed.data && !isLiveFeedUrl(parsed.data.url)) return { error: "Only RACE RESULT feeds (api.raceresult.com) and Arrow Live Results pages (arrowliveresults.com) can be polled live." };
  await collection(await getDb(), "races").updateOne({ _id: race._id }, { $set: { liveFeed: parsed.data, updatedAt: new Date(), updatedBy: sessionActor(session!) } });
  return {};
}

/** Turn place counting on or off for a race, with its tracked teams and award lines. */
export async function setRacePlacesAction(raceId: string, places: RacePlaces): Promise<FormState> {
  const session = await getSession();
  const race = await getRace(raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet || !can(session, "gun", meet)) return { error: "Not allowed" };
  const parsed = RacePlaces.safeParse(places);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const ids = parsed.data.teams.map((t) => t.id);
  if (new Set(ids).size !== ids.length) return { error: "Two teams share an id" };
  const keys = parsed.data.teams.map((t) => teamKey(t.name));
  if (new Set(keys).size !== keys.length) return { error: "A team is listed twice" };
  // Our runners are counted by name (or the school's own button); tracking the school too would count them twice.
  const school = await getSchool(meet.schoolId);
  const own = parsed.data.teams.find((t) => school && [school.name, school.shortName].some((n) => teamKey(n) === teamKey(t.name)));
  if (own) return { error: `${own.name} is your school. It's always counted; track the other teams.` };
  const lines = parsed.data.awards.map((a) => a.through);
  if (new Set(lines).size !== lines.length) return { error: "Two award lines end at the same place" };
  await collection(await getDb(), "races").updateOne({ _id: race._id }, { $set: { places: parsed.data, updatedAt: new Date(), updatedBy: sessionActor(session!) } });
  return {};
}

export type TeamSuggestion = { name: string; short: string | null; color: string | null; aliases: string[]; tracked: boolean };

/**
 * Team names to offer when picking teams to track: teams this school tracked before
 * (with their labels and colors), then every team in results imported so far, most seen first.
 */
export async function teamSuggestionsAction(raceId: string): Promise<TeamSuggestion[]> {
  const session = await getSession();
  const race = await getRace(raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet || !can(session, "gun", meet)) return [];
  const db = await getDb();
  const [tracked, seen] = await Promise.all([
    collection(db, "races")
      .find({ schoolId: meet.schoolId, deletedAt: null, "places.teams.0": { $exists: true } }, { projection: { places: 1, updatedAt: 1 } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray(),
    collection(db, "raceEntries")
      .aggregate<{ _id: string; n: number }>([
        { $match: { schoolId: meet.schoolId, deletedAt: null, teamName: { $type: "string" } } },
        { $group: { _id: "$teamName", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 300 },
      ])
      .toArray(),
  ]);
  const school = await getSchool(meet.schoolId);
  const ownKeys = new Set(school ? [teamKey(school.name), teamKey(school.shortName)] : []);
  const out = new Map<string, TeamSuggestion>();
  for (const r of tracked) {
    for (const t of r.places?.teams ?? []) {
      const k = teamKey(t.name);
      if (!out.has(k) && !ownKeys.has(k)) out.set(k, { name: t.name, short: t.short, color: t.color, aliases: t.aliases, tracked: true });
    }
  }
  for (const e of seen) {
    const k = teamKey(e._id);
    if (k && !out.has(k) && !ownKeys.has(k)) out.set(k, { name: e._id, short: null, color: null, aliases: [], tracked: false });
  }
  return [...out.values()];
}
