import "server-only";
import type { Program } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { type FieldRow, letterStandard } from "./meet-splits";

/**
 * Each meet's varsity letter standard by gender (ms), for the meets given: the split sheet's when it
 * printed one, else from the varsity race's whole field (see letterStandard). Meets with neither are
 * missing from the map.
 */
export async function letterStandards(meetIds: string[], program: Pick<Program, "settings">): Promise<Record<string, Partial<Record<"M" | "F", number>>>> {
  if (meetIds.length === 0) return {};
  const db = await getDb();
  const races = await collection(db, "races").find({ meetId: { $in: meetIds }, deletedAt: null }).toArray();
  const varsity = races.filter((r) => r.levelIds.includes("varsity"));
  const entries = await collection(db, "raceEntries")
    .find({ raceId: { $in: varsity.map((r) => r._id) }, deletedAt: null }, { projection: { raceId: 1, teamName: 1, place: 1, status: 1, timeMs: 1, athleteId: 1 } })
    .toArray();
  const fields: Record<string, FieldRow[]> = {};
  for (const e of entries) (fields[e.raceId] ??= []).push({ team: e.teamName, place: e.place, status: e.status, timeMs: e.timeMs, ours: !!e.athleteId });
  const categoryGender = new Map(program.settings.raceCategories.map((c) => [c.id, c.gender]));
  const out: Record<string, Partial<Record<"M" | "F", number>>> = {};
  for (const r of varsity) {
    const g = categoryGender.get(r.raceCategoryId) ?? (/\bgirls?\b/i.test(r.name) ? "F" : /\bboys?\b/i.test(r.name) ? "M" : null);
    if (g !== "M" && g !== "F") continue;
    const standard = letterStandard(fields[r._id] ?? [], r.sheetSummary);
    if (standard) (out[r.meetId] ??= {})[g] = standard.ms;
  }
  return out;
}
