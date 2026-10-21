import { teamKey } from "@/lib/race-places";

/**
 * A race's official results scored for the results pages (the team's results PDFs): every team's
 * places and points, with each runner's own points. The usual rules, the same as the app's team
 * scores: finishers in place order; only teams with five or more finishers score, and they take
 * places; a team's 6th and 7th displace (their places count against others, not for their team);
 * an 8th runner, a runner without a team, and every runner of a team that doesn't score take no
 * place. Ties go to the team whose 6th runner placed better. Pure, so it can be tested.
 */

export type ResultEntry = { name: string; team: string | null; place: number | null; status: string; timeMs: number | null; ours: boolean };

export type TeamResult = {
  key: string;
  /** As the results print it. */
  name: string;
  /** Null for a team that didn't score. */
  place: number | null;
  points: number | null;
  /** Scoring places of its runners in order: five, then the 6th and 7th. */
  places: number[];
  finishers: number;
  ours: boolean;
};

/** A runner's points: their scoring place, `displacer` for a team's 6th or 7th; null when they took none. */
export type RunnerPoints = { points: number; displacer: boolean; teamRank: number } | null;

export function scoreRace(entries: ResultEntry[]): { teams: TeamResult[]; incomplete: string[]; points: RunnerPoints[] } {
  // Our runners count as one team whatever spelling a sheet used for us.
  const ourKeys = new Map<string, number>();
  for (const e of entries) if (e.ours && e.team) ourKeys.set(teamKey(e.team), (ourKeys.get(teamKey(e.team)) ?? 0) + 1);
  const ourKey = [...ourKeys].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "__ours__";
  const keyOf = (e: ResultEntry) => (e.ours ? ourKey : e.team ? teamKey(e.team) : null);

  const order = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.status === "finished" && e.place !== null)
    .sort((a, b) => a.e.place! - b.e.place!);
  const finishers = new Map<string, number>();
  const names = new Map<string, string>();
  for (const { e } of order) {
    const k = keyOf(e);
    if (!k) continue;
    finishers.set(k, (finishers.get(k) ?? 0) + 1);
    if (!names.has(k) || e.ours) names.set(k, e.team ?? "");
  }

  const points: RunnerPoints[] = entries.map(() => null);
  const places = new Map<string, number[]>();
  let p = 0;
  for (const { e, i } of order) {
    const k = keyOf(e);
    if (!k || (finishers.get(k) ?? 0) < 5) continue;
    const list = places.get(k) ?? [];
    if (list.length >= 7) continue;
    p += 1;
    list.push(p);
    places.set(k, list);
    points[i] = { points: p, displacer: list.length > 5, teamRank: list.length };
  }

  const teams: TeamResult[] = [...finishers.keys()].map((k) => {
    const pl = places.get(k) ?? [];
    const scores = (finishers.get(k) ?? 0) >= 5;
    return { key: k, name: names.get(k) ?? k, place: null, points: scores ? pl.slice(0, 5).reduce((a, b) => a + b, 0) : null, places: pl, finishers: finishers.get(k) ?? 0, ours: k === ourKey };
  });
  const scoring = teams.filter((t) => t.points !== null).sort((a, b) => a.points! - b.points! || (a.places[5] ?? Infinity) - (b.places[5] ?? Infinity));
  scoring.forEach((t, n) => (t.place = n + 1));
  const incomplete = teams
    .filter((t) => t.points === null)
    .map((t) => t.name)
    .sort((a, b) => a.localeCompare(b));
  return { teams: scoring, incomplete, points };
}

/** Our top five's average and the gap from our 1st to our 5th, by finish time. Null under five finishers. */
export function topFive(times: number[]): { average: number; spread: number } | null {
  const five = [...times].sort((a, b) => a - b).slice(0, 5);
  if (five.length < 5) return null;
  return { average: Math.round(five.reduce((a, b) => a + b, 0) / 5), spread: five[4] - five[0] };
}

/**
 * Each stretch on its own from a runner's published mat splits (cumulative), against the race's split
 * labels in order, then the last stretch to the finish. Clock times truncated to the second first, so
 * the stretches add up to the finish as printed. Null where a split is missing or out of order.
 */
export function officialSegments(splits: { label: string; cumulativeMs: number }[], labels: string[], finishMs: number | null): (number | null)[] {
  const whole = (ms: number | null | undefined) => (ms == null ? null : Math.floor(ms / 1000) * 1000);
  const ends = [0, ...labels.map((l) => whole(splits.find((s) => s.label === l)?.cumulativeMs)), whole(finishMs)];
  return ends.slice(1).map((ms, i) => (ms === null || ends[i] === null || ms <= ends[i]! ? null : ms - ends[i]!));
}

/** The split labels a race's results publish, in race order (from the runner with the most). */
export function splitLabels(entries: { splits: { label: string; cumulativeMs: number }[] }[]): string[] {
  const most = entries.reduce<{ label: string; cumulativeMs: number }[]>((m, e) => (e.splits.length > m.length ? e.splits : m), []);
  return [...most].sort((a, b) => a.cumulativeMs - b.cumulativeMs).map((s) => s.label);
}
