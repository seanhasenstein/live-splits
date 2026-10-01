import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getMeet, getRace } from "@/lib/data";
import { recordTaps, TapError, TapInput } from "@/lib/taps";

const Body = z.object({ taps: z.array(TapInput).min(1).max(200) });

/** Devices POST taps here (one race per request). Retries are safe. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const { taps } = parsed.data;
  const race = await getRace(taps[0].raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet) return Response.json({ error: "Race not found" }, { status: 404 });

  try {
    const result = await recordTaps(await getSession(), race, meet, taps);
    return Response.json({
      accepted: result.accepted,
      gunTimeMs: result.race.gunTimeMs,
      serverTimeMs: Date.now(),
    });
  } catch (err) {
    if (err instanceof TapError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
