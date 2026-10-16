import { can, getSession } from "@/lib/auth/session";
import { getMeet, getRace } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { type FieldEntry, getOfficialField, getOfficialTimes } from "@/lib/results/import";
import { getLiveField, getLiveOfficial, liveFeedActive } from "@/lib/results/live";

/** A record screen counts as "here" this long after its last poll. */
const PRESENCE_MS = 2 * 60_000;

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


  const url = new URL(request.url);
  const since = Number(url.searchParams.get("since") ?? 0);
  const session = await getSession();
  const db = await getDb();

  // `?at=<checkpointId>` is the record screen saying where it is; remembered on the session
  // so the results page can show who's covering each checkpoint. Refreshed at most every 20 s.
  const at = url.searchParams.get("at");
  const jobParam = url.searchParams.get("job");
  const job = jobParam === "places" || jobParam === "both" ? jobParam : "times";
  const staff = can(session, "tap", meet);
  if (session && at && staff && race.checkpoints.some((c) => c.id === at)) {
    const p = session.presence;
    if (!p || p.raceId !== race._id || p.checkpointId !== at || p.job !== job || Date.now() - p.at.getTime() > 20_000) {
      await collection(db, "sessions").updateOne({ _id: session._id }, { $set: { presence: { raceId: race._id, checkpointId: at, job, at: new Date() } } });
    }
  }
  // Who is recording where, and doing what: for coaches and managers only, never the public.
  const recording = staff
    ? (
        await collection(db, "sessions")
          .find({ "presence.raceId": race._id, "presence.at": { $gt: new Date(Date.now() - PRESENCE_MS) }, revokedAt: null }, { projection: { name: 1, "presence.checkpointId": 1, "presence.job": 1 } })
          .toArray()
      ).map((s) => ({ name: s.name, checkpointId: s.presence!.checkpointId, job: s.presence!.job ?? "times", me: s._id === session?._id }))
    : [];
  // Taps whose insert is still in flight have an earlier createdAt than this poll; re-send a
  // generous window (clients dedupe by clientTapId) so a slow write is never skipped.
  const serverTimeMs = Date.now() - 5000;
  const taps = await collection(db, "taps")
    .find(since > 0 ? { raceId, createdAt: { $gt: new Date(since) } } : { raceId })
    .sort({ createdAt: 1 })
    .project({ _id: 0, schoolId: 0, schemaVersion: 0, meetId: 0 })
    .toArray();

  // Official times ride along: imported ones on the first fetch only (they're small and
  // change rarely); a live feed's on every poll while the race runs (throttled upstream).
  const live = liveFeedActive(race);
  const official = live ? await getLiveOfficial(meet, race) : since > 0 ? undefined : await getOfficialTimes(race);
  // The whole field, for team scores: only when the race counts places and this viewer may see them.
  const showPlaces = !!race.places?.on && (race.places.public || can(session, "tap", meet));
  const field: FieldEntry[] | undefined = !showPlaces || official === undefined ? undefined : live ? await getLiveField(meet, race) : await getOfficialField(race);

  return Response.json(
    { taps, gunTimeMs: race.gunTimeMs, serverTimeMs, official, field, officialLive: live, finished: !!race.finishedAt, recording },
    { headers: { "Cache-Control": "no-store" } },
  );
}
