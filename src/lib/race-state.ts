import "server-only";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import type { Race } from "@/lib/db/schema";
import { type RaceState, replay } from "@/lib/replay";

/** Replay a race's full tap log on the server. */
export async function getRaceState(race: Race): Promise<RaceState> {
  const taps = await collection(await getDb(), "taps").find({ raceId: race._id }).toArray();
  return replay(race, taps);
}
