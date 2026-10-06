import "server-only";
import type { Meet, Race } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { checkpointForLabel, type OfficialTimes } from "./import";
import { matchAthlete } from "./match";
import { fromRaceResultUrl } from "./sources";

/**
 * Official times from a race's live feed while it is in progress. The feed is
 * read at most once every UPSTREAM_MS per race (per server instance), however
 * many phones are polling; the result rides along on the taps response. Only
 * exact and alias name matches count: a live feed is nobody's chance to
 * confirm a spelling. The real import, after the race, is still the record.
 */
const UPSTREAM_MS = 15_000;
const cache = new Map<string, { at: number; data: OfficialTimes; inflight: Promise<OfficialTimes> | null }>();

export function liveFeedActive(race: Pick<Race, "liveFeed" | "gunTimeMs" | "finishedAt" | "officialImportId">): boolean {
  return !!race.liveFeed && race.gunTimeMs !== null && !race.finishedAt && !race.officialImportId;
}

export async function getLiveOfficial(meet: Meet, race: Race): Promise<OfficialTimes> {
  if (!race.liveFeed) return {};
  const entry = cache.get(race._id);
  const now = Date.now();
  if (entry && now - entry.at < UPSTREAM_MS) return entry.data;
  if (entry?.inflight) return entry.inflight;
  const inflight = fetchLive(meet, race)
    .then((data) => {
      cache.set(race._id, { at: Date.now(), data, inflight: null });
      return data;
    })
    .catch(() => {
      // Upstream hiccup: keep showing what we had, and try again next window.
      const data = entry?.data ?? {};
      cache.set(race._id, { at: Date.now(), data, inflight: null });
      return data;
    });
  cache.set(race._id, { at: entry?.at ?? 0, data: entry?.data ?? {}, inflight });
  return inflight;
}

async function fetchLive(meet: Meet, race: Race): Promise<OfficialTimes> {
  const contest = await fromRaceResultUrl(race.liveFeed!.url, race.liveFeed!.contestName ?? undefined);
  const athletes = await collection(await getDb(), "athletes")
    .find({ _id: { $in: race.lineup.map((l) => l.athleteId) }, schoolId: meet.schoolId, deletedAt: null })
    .toArray();
  const out: OfficialTimes = {};
  for (const e of contest.entries) {
    const m = matchAthlete(e, athletes);
    if (!m.athlete || out[m.athlete._id]) continue;
    const byCheckpoint: Record<string, number> = {};
    for (const [label, ms] of Object.entries(e.splits)) {
      const id = checkpointForLabel(race, label);
      if (id) byCheckpoint[id] = ms;
    }
    out[m.athlete._id] = { finishMs: e.finishMs, status: e.status, place: e.place, byCheckpoint };
  }
  return out;
}
