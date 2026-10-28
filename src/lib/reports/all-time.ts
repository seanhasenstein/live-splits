/**
 * The program's all-time State meet list: every performance our runners ran at State, one list per
 * gender and distance (girls ran 4K before the move to 5K). Ranked to the whole second (older results
 * were printed in whole seconds), ties sharing a rank. Pure, for the list page and the live board.
 */

export const STATE_SERIES = "short:state";

/** Is this the State meet: short name "State", or a name that says so. */
export function isStateMeet(m: { series?: string; shortName?: string | null; name: string }): boolean {
  if (m.series === STATE_SERIES || m.shortName?.trim().toLowerCase() === "state") return true;
  // "WIAA State Meet", "WIAA Division 3 State Championships", "WIAA State Cross Country Championships".
  return /\bstate meet\b|\bwiaa\b.*\bstate\b|\bstate\b.*\bchampionships?\b/i.test(m.name);
}

const sec = (ms: number) => Math.floor(ms / 1000);

/** Rank of a time among others (1 + how many were faster to the second); `among` needn't be sorted. */
export function allTimeRank(ms: number, among: number[]): number {
  const s = sec(ms);
  let faster = 0;
  for (const t of among) if (sec(t) < s) faster++;
  return faster + 1;
}

export type AllTimeRow = {
  rank: number;
  name: string;
  year: number;
  grade: number | null;
  timeMs: number;
  /** As printed, for the records from before the app. */
  timeText: string | null;
  place: number | null;
  athleteId: string | null;
  /** From this season (highlighted on the list). */
  current: boolean;
};

/** Ranked rows, fastest first: a shared rank in order of the time as printed, then year, then name. */
export function rankRows(rows: Omit<AllTimeRow, "rank">[]): AllTimeRow[] {
  const all = rows.map((r) => r.timeMs);
  return rows.map((r) => ({ ...r, rank: allTimeRank(r.timeMs, all) })).sort((a, b) => a.rank - b.rank || a.timeMs - b.timeMs || a.year - b.year || a.name.localeCompare(b.name));
}

/** The rank label: "#7 all-time at State", or "#7 all-time at State (4K)" when the distance needs saying. */
export function rankLabel(rank: number, meters?: number): string {
  return `#${rank} all-time at State${meters && meters !== 5000 ? ` (${meters / 1000}K)` : ""}`;
}
