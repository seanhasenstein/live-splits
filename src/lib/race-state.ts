import "server-only";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import type { Race } from "@/lib/db/schema";
import { type AthleteStatus, type RaceState, replay, replayStatuses } from "@/lib/replay";

/** Replay a race's full tap log on the server. */
export async function getRaceState(race: Race): Promise<RaceState> {
  const taps = await collection(await getDb(), "taps").find({ raceId: race._id }).toArray();
  return replay(race, taps);
}

/** Replay plus each athlete's DNS / DNR / DNF status. */
export async function getRaceStateWithStatuses(race: Race): Promise<{ state: RaceState; statuses: Map<string, AthleteStatus> }> {
  const taps = await collection(await getDb(), "taps").find({ raceId: race._id }).toArray();
  return { state: replay(race, taps), statuses: replayStatuses(taps) };
}
