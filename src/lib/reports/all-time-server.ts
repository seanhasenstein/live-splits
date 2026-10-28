import "server-only";
import type { Program } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { type AllTimeRow, isStateMeet, rankRows } from "./all-time";
import { getTeamHistory } from "./history";

export type AllTimeList = { gender: "M" | "F"; meters: number; rows: AllTimeRow[] };

/**
 * The State all-time lists: the coach's records (loaded with db:all-time) for the years before the app,
 * then every State result in the app from the year after the records end. `except` leaves one State meet
 * out, by id and by year (the live board ranks a race's runners against everyone before them, and the
 * records may hold that year too).
 */
export async function getStateLists(schoolId: string, program: Pick<Program, "_id" | "settings">, currentYear: number, except?: { meetId: string; year: number }): Promise<AllTimeList[]> {
  const db = await getDb();
  const [stored, athletes, distances] = await Promise.all([
    collection(db, "allTimeEntries").find({ schoolId, list: "state", deletedAt: null }).toArray(),
    collection(db, "athletes").find({ schoolId, deletedAt: null }, { projection: { displayName: 1, gender: 1 } }).toArray(),
    collection(db, "distances").find({ sport: "xc" }, { projection: { meters: 1 } }).toArray(),
  ]);
  const athleteById = new Map(athletes.map((a) => [a._id, a]));
  const metersOf = new Map(distances.map((d) => [d._id, d.meters]));
  const groups = new Map<string, { gender: "M" | "F"; meters: number; rows: Omit<AllTimeRow, "rank">[]; lastRecordYear: number }>();
  const group = (gender: "M" | "F", meters: number) => {
    const k = `${gender}:${meters}`;
    if (!groups.has(k)) groups.set(k, { gender, meters, rows: [], lastRecordYear: 0 });
    return groups.get(k)!;
  };
  for (const e of stored) {
    if ((e.gender !== "M" && e.gender !== "F") || e.year === except?.year) continue;
    const g = group(e.gender, e.distanceMeters);
    g.rows.push({ name: e.name, year: e.year, grade: e.grade, timeMs: e.timeMs, timeText: e.timeText, place: e.place, athleteId: e.athleteId, current: e.year === currentYear });
    g.lastRecordYear = Math.max(g.lastRecordYear, e.year);
  }

  const history = await getTeamHistory(schoolId, program, athletes.map((a) => a._id));
  const meets = await collection(db, "meets")
    .find({ _id: { $in: [...new Set(history.map((h) => h.meetId))] } }, { projection: { name: 1, shortName: 1 } })
    .toArray();
  const stateMeets = new Set(meets.filter((m) => isStateMeet(m)).map((m) => m._id));
  for (const h of history) {
    if (!stateMeets.has(h.meetId) || h.meetId === except?.meetId || Number(h.date.slice(0, 4)) === except?.year || h.status !== "finished" || h.finishMs === null || !h.distanceId) continue;
    const a = athleteById.get(h.athleteId);
    const meters = metersOf.get(h.distanceId);
    if (!a || (a.gender !== "M" && a.gender !== "F") || !meters) continue;
    const g = group(a.gender, meters);
    const year = Number(h.date.slice(0, 4));
    // The records cover their years; the app takes over after them.
    if (year <= g.lastRecordYear) continue;
    g.rows.push({ name: a.displayName, year, grade: h.grade, timeMs: h.finishMs, timeText: null, place: h.place, athleteId: a._id, current: year === currentYear });
  }

  return [...groups.values()]
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => (a.gender === b.gender ? b.meters - a.meters : a.gender === "M" ? -1 : 1))
    .map((g) => ({ gender: g.gender, meters: g.meters, rows: rankRows(g.rows) }));
}
