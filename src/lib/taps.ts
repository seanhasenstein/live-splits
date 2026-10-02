import "server-only";
import { MongoBulkWriteError } from "mongodb";
import { z } from "zod";
import { can, sessionActor } from "@/lib/auth/session";
import { getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import { EpochMs, Id, type Meet, type Race, type Session, type Tap, TapType } from "@/lib/db/schema";

/** What a device sends. The server adds identity, meet, and serverTimeMs. */
export const TapInput = z.object({
  clientTapId: z.string().min(8).max(64),
  type: TapType,
  raceId: Id,
  checkpointId: z.string().min(1).nullable(),
  athleteId: Id.nullable(),
  targetTapId: z.string().min(1).nullable(),
  deviceTimeMs: EpochMs,
  clockOffsetMs: z.int(),
  timeMs: EpochMs.nullable(),
  estimate: z.boolean(),
  missed: z.boolean(),
  note: z.string().max(500).nullable(),
});
export type TapInput = z.infer<typeof TapInput>;

export class TapError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Append taps for one race. Idempotent on clientTapId: a retry of an already
 * stored tap is reported as accepted. Gun taps also update the race's gun time.
 */
export async function recordTaps(
  session: Session | null,
  race: Race,
  meet: Meet,
  inputs: TapInput[],
): Promise<{ accepted: string[]; race: Race }> {
  if (!session) throw new TapError("Not signed in", 401);
  const needsGun = inputs.some((t) => t.type === "gun");
  if (!can(session, "tap", meet) || (needsGun && !can(session, "gun", meet))) {
    throw new TapError("Not allowed", 403);
  }
  for (const t of inputs) {
    if (t.raceId !== race._id) throw new TapError("All taps must belong to the race", 400);

    if (t.checkpointId && !race.checkpoints.some((c) => c.id === t.checkpointId)) {
      throw new TapError(`Unknown checkpoint ${t.checkpointId}`, 400);
    }
  }

  const taps: Tap[] = inputs.map((t) =>
    COLLECTIONS.taps.schema.parse({
      _id: newId(),
      schoolId: meet.schoolId,
      schemaVersion: COLLECTIONS.taps.version,
      ...t,
      meetId: meet._id,
      serverTimeMs: t.deviceTimeMs + t.clockOffsetMs,
      createdAt: new Date(0), // set just before insert, below
      createdBy: sessionActor(session),
    }),
  );

  const db = await getDb();
  const tapsCol = collection(db, "taps");
  // Retries from the local queue: skip what we already have so an old gun tap
  // arriving late can't overwrite a newer one.
  const existing = new Set(
    (await tapsCol.find({ clientTapId: { $in: taps.map((t) => t.clientTapId) } }, { projection: { clientTapId: 1 } }).toArray()).map(
      (t) => t.clientTapId,
    ),
  );
  // Stamp createdAt as late as possible: pollers use it as a cursor.
  const now = new Date();
  const fresh = taps.filter((t) => !existing.has(t.clientTapId)).map((t) => ({ ...t, createdAt: now }));
  // A live START on a race that already has a gun would silently re-base every time.
  // Typed overrides (timeMs set) are deliberate; a retry of the START we already stored is fine.
  if (race.gunTimeMs !== null && fresh.some((t) => t.type === "gun" && t.timeMs === null)) {
    throw new TapError("This race was already started. Use Adjust to change the gun time.", 409);
  }
  if (fresh.length > 0) {
    try {
      await tapsCol.insertMany(fresh, { ordered: false });
    } catch (err) {
      // Two devices racing on the same clientTapId is still a duplicate, not a failure.
      if (!(err instanceof MongoBulkWriteError)) throw err;
      const writeErrors = Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors];
      if (writeErrors.some((e) => e.code !== 11000)) throw err;
    }
  }

  let updatedRace = race;
  const gun = fresh.filter((t) => t.type === "gun").at(-1);
  if (gun) {
    const gunTimeMs = gun.timeMs ?? gun.serverTimeMs;
    const gunTimeSource = gun.timeMs === null ? "tap" : "manual";
    await collection(db, "races").updateOne(
      { _id: race._id },
      { $set: { gunTimeMs, gunTimeSource, updatedAt: now, updatedBy: sessionActor(session) } },
    );
    updatedRace = { ...race, gunTimeMs, gunTimeSource };
  }

  return { accepted: inputs.map((t) => t.clientTapId), race: updatedRace };
}
