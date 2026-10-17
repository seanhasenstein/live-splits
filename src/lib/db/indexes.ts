import type { Db, IndexDescription } from "mongodb";
import type { CollectionName } from "./collections";

/** Index definitions. Applied by `pnpm db:indexes` (idempotent). */
export const INDEXES: Partial<Record<CollectionName, IndexDescription[]>> = {
  schools: [{ key: { "viewerLink.tokenHash": 1 }, partialFilterExpression: { "viewerLink.tokenHash": { $type: "string" } } }],
  programs: [
    { key: { schoolId: 1, sport: 1 }, unique: true },
    // Join by workout code.
    { key: { "workoutCode.hash": 1 }, partialFilterExpression: { "workoutCode.hash": { $type: "string" } } },
  ],
  seasons: [{ key: { programId: 1, label: 1 }, unique: true }],
  athletes: [{ key: { schoolId: 1, aliases: 1 } }],
  seasonRosters: [
    { key: { seasonId: 1, athleteId: 1 }, unique: true },
    { key: { athleteId: 1 } },
  ],
  distances: [{ key: { sport: 1, value: 1, unit: 1 }, unique: true }],
  courses: [{ key: { venueId: 1 } }],
  meets: [
    { key: { schoolId: 1, seasonId: 1, date: 1 } },
    { key: { courseId: 1 } },
    { key: { meetSeriesId: 1 } },
    // Join-code lookups. Partial so the nulls on meets without codes stay out.
    ...(["managerCodeHash", "coachCodeHash", "viewerTokenHash"] as const).map((f) => ({
      key: { [`joinCodes.${f}`]: 1 },
      partialFilterExpression: { [`joinCodes.${f}`]: { $type: "string" } },
    })),
  ],
  races: [{ key: { meetId: 1 } }],
  results: [
    { key: { schoolId: 1, athleteId: 1, distanceId: 1, "mark.value": 1 } },
    { key: { schoolId: 1, raceId: 1 } },
    // Official times per race (taps poll, compare, export) and the per-athlete upsert on import.
    { key: { raceId: 1, athleteId: 1 } },
  ],
  raceEntries: [{ key: { raceId: 1, place: 1 } }],
  taps: [
    { key: { raceId: 1, checkpointId: 1, serverTimeMs: 1 } },
    { key: { clientTapId: 1 }, unique: true },
  ],
  users: [{ key: { schoolId: 1, email: 1 }, unique: true }],
  workouts: [{ key: { schoolId: 1, programId: 1, date: -1 } }],
  workoutTemplates: [{ key: { schoolId: 1, programId: 1, name: 1 } }],
  workoutEvents: [
    { key: { workoutId: 1, serverTimeMs: 1 } },
    { key: { clientEventId: 1 }, unique: true },
  ],
  sessions: [
    { key: { tokenHash: 1 }, unique: true },
    // Who's recording where: polled every few seconds per race.
    { key: { "presence.raceId": 1, "presence.at": 1 }, partialFilterExpression: { "presence.raceId": { $type: "string" } } },
    // Who's timing which workout group.
    { key: { "workoutPresence.workoutId": 1, "workoutPresence.at": 1 }, partialFilterExpression: { "workoutPresence.workoutId": { $type: "string" } } },
  ],
  pins: [{ key: { userId: 1 } }],
};

export async function ensureIndexes(db: Db): Promise<void> {
  for (const [name, indexes] of Object.entries(INDEXES)) {
    await db.collection(name).createIndexes(indexes);
  }
}
