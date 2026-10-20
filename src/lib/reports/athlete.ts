import { formatElapsed } from "@/lib/time";
import type { HistoryRow } from "./history";

/**
 * One athlete's races, ready for the athlete pages and race previews: segment splits (Mile 1,
 * Mile 2, the last stretch), place in the field and among the team in that race, change from the
 * race before, and which race holds each best. Pure, so it can be tested without a database.
 */

export type AthleteRace = HistoryRow & {
  /** "'26 Big East". */
  label: string;
  /** Where among our runners in the same race ("2 of 7"). */
  teamPlace: { place: number; of: number } | null;
  /** Finish change from their previous race at this distance (negative = faster). */
  vsPrev: number | null;
  pr: boolean;
  sb: boolean;
  courseBest: boolean;
};

export type AthleteSummary = {
  races: AthleteRace[];
  careerBest: AthleteRace | null;
  seasonBest: AthleteRace | null;
  lastRace: AthleteRace | null;
  courseBest: AthleteRace | null;
  /** Races on `courseId`, oldest first. */
  onCourse: AthleteRace[];
  /** This season's races, oldest first. */
  season: AthleteRace[];
};

/**
 * `teamRows`: every result of ours in the races this athlete ran (for team places). `before`: only
 * races before this date count (a preview looks back from the meet); omit for a whole career.
 */
export function summarizeAthlete(input: {
  athleteId: string;
  rows: HistoryRow[];
  teamRows: HistoryRow[];
  distanceId: string | null;
  seasonId: string;
  courseId: string | null;
  before?: string;
}): AthleteSummary {
  const mine = input.rows
    .filter((r) => r.athleteId === input.athleteId && (input.distanceId === null || r.distanceId === input.distanceId) && (input.before === undefined || r.date < input.before))
    .sort((a, b) => a.date.localeCompare(b.date));
  const byRace = new Map<string, HistoryRow[]>();
  for (const r of input.teamRows) if (r.finishMs !== null && r.status === "finished") byRace.set(r.raceId, [...(byRace.get(r.raceId) ?? []), r]);

  let prevMs: number | null = null;
  const races = mine.map((r): AthleteRace => {
    const finished = r.status === "finished" && r.finishMs !== null;
    const mates = byRace.get(r.raceId) ?? [];
    const teamPlace = finished && mates.length > 0 ? { place: 1 + mates.filter((m) => m.finishMs! < r.finishMs!).length, of: mates.length } : null;
    const vsPrev = finished && prevMs !== null ? r.finishMs! - prevMs : null;
    if (finished && r.counts) prevMs = r.finishMs;
    return { ...r, label: `'${r.date.slice(2, 4)} ${r.meetShort}`, teamPlace, vsPrev, pr: false, sb: false, courseBest: false };
  });

  const fastest = (rs: AthleteRace[]) => rs.filter((r) => r.counts && r.finishMs !== null).reduce<AthleteRace | null>((b, r) => (b === null || r.finishMs! < b.finishMs! ? r : b), null);
  const careerBest = fastest(races);
  const season = races.filter((r) => r.seasonId === input.seasonId);
  const seasonBest = fastest(season);
  const onCourse = input.courseId === null ? [] : races.filter((r) => r.courseId === input.courseId);
  const courseBest = fastest(onCourse);
  for (const r of races) {
    r.pr = r === careerBest;
    r.sb = r === seasonBest;
    r.courseBest = r === courseBest;
  }
  const lastRace = [...races].reverse().find((r) => r.finishMs !== null) ?? null;
  return { races, careerBest, seasonBest, lastRace, courseBest, onCourse, season };
}

/**
 * A race's time for each stretch of `checkpoints` (today's course: Mile 1, Mile 2), then the last
 * stretch to the finish. Splits are matched by distance; a stretch whose either end is missing, or
 * ends at a mis-tapped split (no later than the one before it), is null rather than a wrong number.
 */
export function segmentsAt(r: Pick<HistoryRow, "splits" | "finishMs" | "status">, checkpoints: { meters: number }[]): (number | null)[] {
  const at = checkpoints.map((c) => r.splits.find((s) => Math.abs(s.meters - c.meters) <= 50)?.ms ?? null);
  // A time no later than the one before it is a mis-tap: drop it, so neither stretch beside it uses it.
  let last = 0;
  const ends = [0, ...at, r.status === "finished" ? r.finishMs : null].map((ms) => {
    if (ms === null || ms <= last) return ms === 0 ? 0 : null;
    last = ms;
    return ms;
  });
  return ends.slice(1).map((ms, i) => (ms === null || ends[i] === null ? null : ms - ends[i]!));
}

/**
 * A few facts worth a runner knowing before a race, from their own history: last year at this meet
 * against their best since, their streak as our first runner across the line, and how far they've
 * come since the first race of the season. At most `max`, most telling first.
 */
export function worthKnowing(s: AthleteSummary, opts: { series: string; team: string; max?: number }): string[] {
  const t = (ms: number) => formatElapsed(Math.abs(ms), "seconds");
  const facts: string[] = [];
  const lastHere = [...s.races].reverse().find((r) => r.series === opts.series && r.finishMs !== null && r.seasonId !== s.season[0]?.seasonId);
  if (lastHere && s.seasonBest) {
    const diff = s.seasonBest.finishMs! - lastHere.finishMs!;
    facts.push(
      `Ran ${t(lastHere.finishMs!)} here in ${lastHere.date.slice(0, 4)}${lastHere.place ? ` (${ordinal(lastHere.place)})` : ""}. This season's best, ${t(s.seasonBest.finishMs!)}, is ${diff < 0 ? `${t(diff)} faster` : diff > 0 ? `${t(diff)} slower` : "the same time"}.`,
    );
  } else if (!lastHere) {
    facts.push(`First time running this meet.`);
  }
  // Consecutive races this season as our first runner across the line, counting back from the last.
  let streak = 0;
  for (const r of [...s.season].reverse()) {
    if (r.teamPlace?.place === 1 && r.teamPlace.of > 1) streak++;
    else break;
  }
  if (streak >= 2) facts.push(`First ${opts.team} runner across the line in each of the last ${streak} races.`);
  const first = s.season.find((r) => r.finishMs !== null);
  if (first && s.seasonBest && s.seasonBest !== first && s.seasonBest.finishMs! < first.finishMs!) {
    facts.push(`${t(first.finishMs! - s.seasonBest.finishMs!)} faster than the first race of the season (${t(first.finishMs!)} at ${first.meetShort}).`);
  }
  if (s.courseBest && facts.length < (opts.max ?? 3)) {
    facts.push(`Best on this course: ${t(s.courseBest.finishMs!)} at ${s.courseBest.meetShort} ${s.courseBest.date.slice(0, 4)}.`);
  }
  return facts.slice(0, opts.max ?? 3);
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
