import { can, getSession } from "@/lib/auth/session";
import { getMeet, getRace } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";

/**
 * A race's tap log, for the tap screen and live board (polled every few
 * seconds). `?since=<ms>` returns only taps stored after that server time;
 * the response's `serverTimeMs` is the next `since`.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/races/[raceId]/taps">) {
  const { raceId } = await params;
  const race = await getRace(raceId);
  const meet = race && (await getMeet(race.meetId));
  if (!race || !meet) return Response.json({ error: "Race not found" }, { status: 404 });
  if (!can(await getSession(), "view", meet)) return Response.json({ error: "Not allowed" }, { status: 403 });

  const since = Number(new URL(request.url).searchParams.get("since") ?? 0);
  // Taps stored in the last second may still be landing; re-send that window so none are missed.
  const serverTimeMs = Date.now() - 1000;
  const taps = await collection(await getDb(), "taps")
    .find(since > 0 ? { raceId, createdAt: { $gt: new Date(since) } } : { raceId })
    .sort({ createdAt: 1 })
    .project({ _id: 0, schoolId: 0, schemaVersion: 0, meetId: 0 })
    .toArray();

  return Response.json(
    { taps, gunTimeMs: race.gunTimeMs, serverTimeMs },
    { headers: { "Cache-Control": "no-store" } },
  );
}
