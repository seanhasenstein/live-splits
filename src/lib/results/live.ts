import "server-only";
import type { Meet, Race } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { checkpointForLabel, type FieldEntry, type OfficialTimes } from "./import";
import { matchAthlete } from "./match";
import { fromFeedUrl } from "./sources";

/**
 * Official times from a race's live feed while it is in progress. The feed is
 * read at most once every UPSTREAM_MS per race (per server instance), however
 * many phones are polling, and never in a poll's critical path (stale while
 * revalidating); the result rides along on the taps response. Only
 * exact and alias name matches count: a live feed is nobody's chance to
 * confirm a spelling. The real import, after the race, is still the record.
 */
const UPSTREAM_MS = 15_000;
type Snapshot = { data: OfficialTimes; field: FieldEntry[] };
const cache = new Map<string, { at: number; data: OfficialTimes; field: FieldEntry[]; inflight: Promise<Snapshot> | null }>();

export function liveFeedActive(race: Pick<Race, "liveFeed" | "gunTimeMs" | "finishedAt" | "officialImportId">): boolean {
  return !!race.liveFeed && race.gunTimeMs !== null && !race.finishedAt && !race.officialImportId;
}

export async function getLiveOfficial(meet: Meet, race: Race): Promise<OfficialTimes> {
  return (await getLiveSnapshot(meet, race)).data;
}

/** The whole field from the live feed (every team), for team scores; from the same cached read. */
export async function getLiveField(meet: Meet, race: Race): Promise<FieldEntry[]> {
  return (await getLiveSnapshot(meet, race)).field;
}

async function getLiveSnapshot(meet: Meet, race: Race): Promise<Snapshot> {
  if (!race.liveFeed) return { data: {}, field: [] };
  const key = `${race._id}:${race.liveFeed.url}`;
  const entry = cache.get(key);
  const now = Date.now();
  if (entry && now - entry.at < UPSTREAM_MS) return entry;
  if (!entry?.inflight) {
    const inflight = fetchLive(meet, race)
      .then((snap) => {
        cache.set(key, { at: Date.now(), ...snap, inflight: null });
        return snap;
      })
      .catch(() => {
        // Upstream hiccup: keep showing what we had, and try again next window.
        const was = cache.get(key);
        const snap = { data: was?.data ?? {}, field: was?.field ?? [] };
        cache.set(key, { at: Date.now(), ...snap, inflight: null });
        return snap;
      });
    cache.set(key, { at: entry?.at ?? 0, data: entry?.data ?? {}, field: entry?.field ?? [], inflight });
  }
  // Never make a phone's poll wait on the timing company: serve the last snapshot while the
  // refresh runs. Only the very first read for a feed has nothing to serve, and it returns
  // empty rather than blocking; the next poll picks the data up.
  return cache.get(key)!;
}

async function fetchLive(meet: Meet, race: Race): Promise<Snapshot> {
  const contest = await fromFeedUrl(race.liveFeed!.url, race.liveFeed!.contestName ?? undefined, { live: true });
  const athletes = await collection(await getDb(), "athletes")
    .find({ _id: { $in: race.lineup.map((l) => l.athleteId) }, schoolId: meet.schoolId, deletedAt: null })
    .toArray();
  const out: OfficialTimes = {};
  const field: FieldEntry[] = [];
  for (const e of contest.entries) {
    const m = matchAthlete(e, athletes);
    field.push({ team: e.team, place: e.place, status: e.status, ours: !!m.athlete });
    if (!m.athlete || out[m.athlete._id]) continue;
    const byCheckpoint: Record<string, number> = {};
    for (const [label, ms] of Object.entries(e.splits)) {
      const id = checkpointForLabel(race, label);
      if (id) byCheckpoint[id] = ms;
    }
    out[m.athlete._id] = { finishMs: e.finishMs, status: e.status, place: e.place, byCheckpoint, precision: contest.precision };
  }
  return { data: out, field };
}
