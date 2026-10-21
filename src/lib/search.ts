import "server-only";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { displayCase } from "@/lib/names";

export type SearchHit = {
  kind: "athlete" | "meet" | "runner";
  title: string;
  detail: string;
  href: string;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const formatDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * The app's search (⌘K): our athletes, our meets, and other schools' runners from imported results,
 * each a few at most. Every word of the query must appear (in any order), case-insensitive.
 */
export async function search(schoolId: string, query: string, limit = 6): Promise<SearchHit[]> {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0 || query.trim().length < 2) return [];
  const all = (field: string) => ({
    $and: words.map((w) => ({ [field]: { $regex: escape(w), $options: "i" } })),
  });
  const db = await getDb();
  const [athletes, meets, entries] = await Promise.all([
    collection(db, "athletes")
      .find({ schoolId, deletedAt: null, ...all("displayName") })
      .limit(limit)
      .toArray(),
    collection(db, "meets")
      .find({ schoolId, deletedAt: null, $or: [all("name"), all("shortName")] })
      .sort({ date: -1 })
      .limit(limit)
      .toArray(),
    collection(db, "raceEntries")
      .find({ schoolId, deletedAt: null, athleteId: null, ...all("name") }, { projection: { name: 1, teamName: 1, raceId: 1 } })
      .limit(200)
      .toArray(),
  ]);

  // Other runners: one hit per runner (name and team), at their latest race.
  const races = await collection(db, "races")
    .find({ _id: { $in: [...new Set(entries.map((e) => e.raceId))] } }, { projection: { meetId: 1, name: 1 } })
    .toArray();
  const raceMeet = new Map(races.map((r) => [r._id, r]));
  const meetsOf = await collection(db, "meets")
    .find(
      {
        _id: { $in: [...new Set(races.map((r) => r.meetId))] },
        deletedAt: null,
      },
      { projection: { name: 1, date: 1 } },
    )
    .toArray();
  const meetById = new Map(meetsOf.map((m) => [m._id, m]));
  const runners = new Map<
    string,
    {
      name: string;
      team: string | null;
      raceId: string;
      meetId: string;
      date: string;
      meetName: string;
      races: number;
    }
  >();
  for (const e of entries) {
    const race = raceMeet.get(e.raceId);
    const meet = race && meetById.get(race.meetId);
    if (!race || !meet) continue;
    const key = `${e.name.toLowerCase()}|${(e.teamName ?? "").toLowerCase()}`;
    const had = runners.get(key);
    if (!had || had.date < meet.date)
      runners.set(key, {
        name: displayCase(e.name),
        team: e.teamName,
        raceId: race._id,
        meetId: meet._id,
        date: meet.date,
        meetName: meet.name,
        races: (had?.races ?? 0) + 1,
      });
    else had.races += 1;
  }

  return [
    ...athletes.map((a): SearchHit => ({
      kind: "athlete",
      title: a.displayName,
      detail: a.graduationYear ? `Class of ${a.graduationYear}` : "Our runner",
      href: `/athletes/${a._id}`,
    })),
    ...meets.map((m): SearchHit => ({
      kind: "meet",
      title: m.name,
      detail: formatDate(m.date),
      href: `/meets/${m._id}`,
    })),
    ...[...runners.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit)
      .map((r): SearchHit => ({
        kind: "runner",
        title: r.name,
        detail: `${r.team ?? "No team"} · ${r.meetName}, ${formatDate(r.date)}${r.races > 1 ? ` · ${r.races} races` : ""}`,
        href: `/meets/${r.meetId}/reports/results?race=${r.raceId}&q=${encodeURIComponent(r.name)}#field`,
      })),
  ];
}
