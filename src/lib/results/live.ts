import "server-only";
import type { Meet, Race } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { checkpointForLabel, type FieldEntry, type OfficialTimes } from "./import";
import { matchAthlete } from "./match";
import { fromFeedUrl } from "./sources";

/**
 * Times from a race's live feed (the timing company's live results: preliminary, not official until
 * imported). The feed is read at most once every UPSTREAM_MS per race (per server instance), however
 * many phones are polling; the result rides along on the taps response. Only exact and alias name
 * matches count: a live feed is nobody's chance to confirm a spelling. The import after the race is
 * the record.
 */
const UPSTREAM_MS = 15_000;
/** A server instance with nothing yet waits this long for its first read before answering. */
const FIRST_WAIT_MS = 4_000;
/** A finished race that was never imported stops reading its feed after this long. */
const AFTER_FINISH_MS = 3 * 24 * 60 * 60_000;

/** `okAt`: when the feed last answered (epoch ms on the server), so the board can say it's gone quiet and keep the newer of two. */
export type LiveSnapshot = { data: OfficialTimes; field: FieldEntry[]; okAt: number };
/** `failed`: the last read of the feed failed (a 404 before the race is posted, a dead link, upstream down). */
const cache = new Map<string, { checkedAt: number; snap: LiveSnapshot | null; failed: boolean; inflight: Promise<void> | null }>();

/**
 * Read the feed for a linked race until its results are imported: before the gun (it just has no
 * finishers yet), while it runs, and after it's marked finished (so the results don't vanish before
 * the import), up to a few days after.
 */
export function liveFeedActive(race: Pick<Race, "liveFeed" | "finishedAt" | "officialImportId">, now = Date.now()): boolean {
  if (!race.liveFeed || race.officialImportId) return false;
  return !race.finishedAt || now - race.finishedAt.getTime() < AFTER_FINISH_MS;
}

/**
 * The feed's latest snapshot. `snap` is null when this server instance has no answer yet (its first
 * read is still running) or never got one (`failed`). Polls don't wait on the timing company once
 * there's a recent snapshot; a stale one (this instance hasn't been asked in a while, so others may
 * have newer) waits for its refresh like a first read, so it can't roll a screen back.
 */
export async function getLiveSnapshot(meet: Meet, race: Race): Promise<{ snap: LiveSnapshot | null; failed: boolean }> {
  if (!race.liveFeed) return { snap: null, failed: false };
  const key = `${race._id}:${race.liveFeed.url}`;
  const now = Date.now();
  let entry = cache.get(key);
  if (entry?.snap && now - entry.checkedAt < UPSTREAM_MS) return { snap: entry.snap, failed: entry.failed };
  if (!entry?.inflight && (!entry || now - entry.checkedAt >= UPSTREAM_MS)) {
    const inflight = fetchLive(meet, race)
      .then((snap) => {
        cache.set(key, { checkedAt: Date.now(), snap: { ...snap, okAt: Date.now() }, failed: false, inflight: null });
      })
      .catch(() => {
        // Upstream hiccup: keep what we had (its okAt says how old it is), try again next window.
        cache.set(key, { checkedAt: Date.now(), snap: cache.get(key)?.snap ?? null, failed: true, inflight: null });
      });
    entry = { checkedAt: entry?.checkedAt ?? 0, snap: entry?.snap ?? null, failed: entry?.failed ?? false, inflight };
    cache.set(key, entry);
  }
  const fresh = entry!.snap && now - entry!.snap.okAt < 2 * UPSTREAM_MS;
  if (!fresh && entry!.inflight) await Promise.race([entry!.inflight, new Promise((r) => setTimeout(r, FIRST_WAIT_MS))]);
  const done = cache.get(key)!;
  return { snap: done.snap, failed: done.failed };
}

async function fetchLive(meet: Meet, race: Race): Promise<Omit<LiveSnapshot, "okAt">> {
  const contest = await fromFeedUrl(race.liveFeed!.url, race.liveFeed!.contestName ?? undefined, { live: true });
  const athletes = await collection(await getDb(), "athletes")
    .find({ _id: { $in: race.lineup.map((l) => l.athleteId) }, schoolId: meet.schoolId, deletedAt: null })
    .toArray();
  const out: OfficialTimes = {};
  const field: FieldEntry[] = [];
  for (const e of contest.entries) {
    const m = matchAthlete(e, athletes);
    field.push({ team: e.team, place: e.place, status: e.status, ours: !!m.athlete, name: e.name, timeMs: e.finishMs, grade: e.grade });
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
