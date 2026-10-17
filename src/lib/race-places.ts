import type { AwardLine, TrackedTeam } from "@/lib/db/schema";
import { type RaceState, sortTaps, type TapLike } from "@/lib/replay";
import type { FieldEntry } from "@/lib/results/import";

/**
 * Places at a checkpoint, from the order runners were tapped there. Nothing is
 * stored but the taps: undoing one, swapping two or adding a missed runner
 * re-places everyone behind it. Pure, so the record screen and the board agree.
 *
 * Who passed is a tick's team: "us" (one of ours, on a places-only phone),
 * "other" (anyone untracked: tapping these means the counter is counting
 * everyone, so places are overall), or a tracked team's id. Our runners' name
 * taps count too: on a phone that taps names and teams, they slot in by time;
 * when a places-only phone taps "Us", the 1st Us is the 1st of ours whose name
 * was tapped there, and so on, so the two phones never need to agree to the second.
 */

export type Tick = { tapId: string; team: string; timeMs: number; by: string | null };

/** Each checkpoint's live place taps (edits and voids applied), in passing order. */
export function replayTicks(taps: TapLike[]): Map<string, Tick[]> {
  const ticks = new Map<string, Tick & { checkpointId: string }>();
  const sorted = sortTaps(taps);
  for (const t of sorted) {
    if (t.type === "tick" && t.checkpointId && t.team) ticks.set(t.clientTapId, { tapId: t.clientTapId, checkpointId: t.checkpointId, team: t.team, timeMs: t.timeMs ?? t.serverTimeMs, by: t.createdBy?.name ?? null });
  }
  // Undo can void a tick or an edit of one, whichever order the clocks put them in. A void can itself be
  // voided (undoing a remove brings the tick back, redoing it removes it again…): a void is in effect
  // unless an in-effect void targets it.
  const voidOf = new Map<string, string[]>();
  for (const t of taps) if (t.type === "void" && t.targetTapId) voidOf.set(t.targetTapId, [...(voidOf.get(t.targetTapId) ?? []), t.clientTapId]);
  const memo = new Map<string, boolean>();
  const isVoided = (id: string, depth = 0): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    const result = depth < 50 && (voidOf.get(id) ?? []).some((v) => !isVoided(v, depth + 1));
    memo.set(id, result);
    return result;
  };
  const voided = new Set([...voidOf.keys()].filter((id) => isVoided(id)));
  // Edits after the ticks they fix (a clock resync can order them first); the latest edit wins.
  for (const t of sorted) {
    if (voided.has(t.clientTapId)) continue;
    const x = t.type === "edit" && t.targetTapId ? ticks.get(t.targetTapId) : undefined;
    if (!x) continue;
    if (t.team) x.team = t.team;
    if (t.timeMs !== null) x.timeMs = t.timeMs;
  }
  for (const id of voided) ticks.delete(id);
  const out = new Map<string, Tick[]>();
  for (const { checkpointId, ...x } of ticks.values()) out.set(checkpointId, [...(out.get(checkpointId) ?? []), x]);
  for (const list of out.values()) list.sort((a, b) => a.timeMs - b.timeMs || a.tapId.localeCompare(b.tapId));
  return out;
}

export type PlaceEntry =
  | { kind: "us"; athleteId: string | null; tapId: string | null; timeMs: number }
  | { kind: "team"; teamId: string; tapId: string; timeMs: number; by?: string | null }
  | { kind: "other"; tapId: string; timeMs: number; by?: string | null };

export type TeamScore = {
  /** "us" or a tracked team's id; for official results, the team's name. */
  team: string;
  /** Null when the team has fewer than 5 runners counted (doesn't score). */
  points: number | null;
  /** Scoring places of its top five, then the 6th and 7th (displacers). */
  places: number[];
  /** Runners of theirs counted. */
  runners: number;
};

export type CheckpointPlaces = {
  entries: PlaceEntry[];
  /** Other was tapped here, so everyone was being counted: places are overall. */
  countingAll: boolean;
  /** Our runners' places here: overall when countingAll, else among our runners and the tracked teams'. */
  place: Map<string, number>;
  /** Head to head: scored as if only we and the tracked teams were racing. */
  scores: TeamScore[];
  /** The whole meet, guessed: every Other runner counted as a scorer (≈). Only when countingAll. */
  estimate: TeamScore[] | null;
};

const OTHER = "*";
/** Names tapped this long before the first place tap came before counting started (a phone switched to places partway). */
const US_LEAD_MS = 5_000;
/** After that, a name and an Us tap this far apart, either way, can be the same runner (a counter working through a pack). */
const US_WINDOW_MS = 30_000;
/** What leaving a name or an Us tap unpaired costs, in ms of time difference: pairs closer than this win. */
const US_SKIP_COST_MS = 15_000;

/**
 * Pair names (times, in order) with Us taps (times, in order), keeping both orders, so the total time
 * difference plus US_SKIP_COST_MS for each one left unpaired is smallest. A pair can be at most
 * US_WINDOW_MS apart. Small (our runners at one checkpoint), so a full table is fine.
 * Returns name index → Us tap index.
 */
export function alignUs(names: number[], us: number[]): Map<number, number> {
  const n = names.length;
  const m = us.length;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      if (i === n && j === m) continue;
      let best = Infinity;
      if (i < n) best = Math.min(best, US_SKIP_COST_MS + cost[i + 1][j]);
      if (j < m) best = Math.min(best, US_SKIP_COST_MS + cost[i][j + 1]);
      if (i < n && j < m && Math.abs(names[i] - us[j]) <= US_WINDOW_MS) best = Math.min(best, Math.abs(names[i] - us[j]) + cost[i + 1][j + 1]);
      cost[i][j] = best;
    }
  }
  const pairs = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && Math.abs(names[i] - us[j]) <= US_WINDOW_MS && cost[i][j] === Math.abs(names[i] - us[j]) + cost[i + 1][j + 1]) {
      pairs.set(i++, j++);
    } else if (i < n && cost[i][j] === US_SKIP_COST_MS + cost[i + 1][j]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Places at each checkpoint where someone counted (a checkpoint with no place taps has none).
 * `gunTimeMs` drops name taps from before the gun (a restarted race).
 */
export function racePlaces(
  checkpointIds: string[],
  state: RaceState,
  ticks: Map<string, Tick[]>,
  gunTimeMs: number | null,
  /** Checkpoints this phone is counting at: places from the first name tap, before any place tap (our runner leading). */
  counting: string[] = [],
): Map<string, CheckpointPlaces> {
  const out = new Map<string, CheckpointPlaces>();
  for (const id of checkpointIds) {
    // Taps from before the gun (someone trying the buttons) aren't runners.
    const list = (ticks.get(id) ?? []).filter((t) => gunTimeMs === null || t.timeMs >= gunTimeMs);
    // Nobody counting here: no places (a phone only timing must not rank our runners among themselves).
    if (list.length === 0 && !counting.includes(id)) continue;
    const ours = [...(state.get(id)?.byAthlete.values() ?? [])]
      .filter((m) => !m.missed && m.timeMs !== null && !(gunTimeMs !== null && m.timeMs < gunTimeMs))
      .sort((a, b) => a.timeMs! - b.timeMs! || a.assignedAt - b.assignedAt);
    // A places-only phone's Us taps are our runners: each is paired with a name tapped here (the names
    // phone gives who and when), in order, by the best fit in time (alignUs). Names from before counting
    // started (well before the first place tap: a phone switched to places partway) slot in by time.
    // A name with no Us tap near it (the counter missed that runner) slots in by its own time; an Us
    // tap with no name near it stays nameless. Names after the counter stopped get no place.
    const usTicks = list.filter((t) => t.team === "us");
    const byTime: typeof ours = usTicks.length === 0 ? ours : [];
    const matched = new Map<string, string | null>();
    if (usTicks.length > 0) {
      const counting = ours.filter((m) => m.timeMs! >= list[0].timeMs - US_LEAD_MS);
      byTime.push(...ours.filter((m) => m.timeMs! < list[0].timeMs - US_LEAD_MS));
      const pairs = alignUs(
        counting.map((m) => m.timeMs!),
        usTicks.map((t) => t.timeMs),
      );
      const lastUs = usTicks.at(-1)!.timeMs;
      counting.forEach((m, i) => {
        const j = pairs.get(i);
        if (j !== undefined) matched.set(usTicks[j].tapId, m.athleteId);
        // Unpaired: placed by its own time, unless the counter had already stopped.
        else if (m.timeMs! <= lastUs + US_WINDOW_MS) byTime.push(m);
      });
    }
    const tapped: PlaceEntry[] = list.map((t) =>
      t.team === "us" ? { kind: "us", athleteId: matched.get(t.tapId) ?? null, tapId: t.tapId, timeMs: t.timeMs } : t.team === "other" ? { kind: "other", tapId: t.tapId, timeMs: t.timeMs, by: t.by } : { kind: "team", teamId: t.team, tapId: t.tapId, timeMs: t.timeMs, by: t.by },
    );
    const named: PlaceEntry[] = byTime.map((m) => ({ kind: "us", athleteId: m.athleteId, tapId: null, timeMs: m.timeMs! }));
    const entries = [...named, ...tapped].sort((a, b) => a.timeMs - b.timeMs || (a.tapId ?? "").localeCompare(b.tapId ?? ""));
    const countingAll = entries.some((e) => e.kind === "other");
    const place = new Map<string, number>();
    let n = 0;
    for (const e of entries) {
      if (!countingAll && e.kind === "other") continue;
      n += 1;
      if (e.kind === "us" && e.athleteId) place.set(e.athleteId, n);
    }
    const teamOf = (e: PlaceEntry) => (e.kind === "us" ? "us" : e.kind === "team" ? e.teamId : OTHER);
    out.set(id, {
      entries,
      countingAll,
      place,
      scores: scoreTeams(entries.filter((e) => e.kind !== "other").map(teamOf)),
      estimate: countingAll ? scoreTeams(entries.map(teamOf)) : null,
    });
  }
  return out;
}

/**
 * Cross-country scoring for runners in finishing order, by team: only teams with at least
 * five runners score; their first seven are placed (the rest, and runners of teams that
 * don't score, are taken out first); a team's points are its top five's places, and a tie
 * goes to the better sixth runner. A team key of "*" is a runner who takes a place but
 * whose team we don't know (an Other, in an estimate).
 */
export function scoreTeams(order: string[]): TeamScore[] {
  const counts = new Map<string, number>();
  for (const t of order) if (t !== OTHER) counts.set(t, (counts.get(t) ?? 0) + 1);
  const placed = new Map<string, number[]>();
  let p = 0;
  for (const t of order) {
    if (t === OTHER) {
      p += 1;
      continue;
    }
    if ((counts.get(t) ?? 0) < 5) continue;
    const list = placed.get(t) ?? [];
    if (list.length >= 7) continue;
    p += 1;
    placed.set(t, [...list, p]);
  }
  const teams: TeamScore[] = [...counts].map(([team, runners]) => {
    const places = placed.get(team) ?? [];
    return { team, runners, places, points: runners >= 5 ? places.slice(0, 5).reduce((a, b) => a + b, 0) : null };
  });
  return teams.sort((a, b) => (a.points ?? Infinity) - (b.points ?? Infinity) || (a.places[5] ?? Infinity) - (b.places[5] ?? Infinity) || b.runners - a.runners);
}

/**
 * Team scores from the timing company's results (every team): finishers in place order,
 * scored the usual way. Our runners (and anyone else under our team's name) score as "us";
 * a runner with no team takes a place but scores for nobody. `names` maps each key to the
 * name as printed.
 */
export function fieldScores(field: FieldEntry[]): { scores: TeamScore[]; names: Map<string, string> } {
  const names = new Map<string, string>();
  const ourKeys = new Map<string, number>();
  for (const e of field) if (e.ours && e.team) ourKeys.set(teamKey(e.team), (ourKeys.get(teamKey(e.team)) ?? 0) + 1);
  const ourKey = [...ourKeys].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const order = field
    .filter((e) => e.status === "finished" && e.place !== null)
    .sort((a, b) => a.place! - b.place!)
    // A runner with no team (unattached) isn't on a scoring team: taken out, like any non-scorer.
    .filter((e) => e.team || e.ours)
    .map((e) => {
      if (!e.team) return "us";
      // By team, not by name match: another school's runner can share a name with one of ours.
      const k = teamKey(e.team);
      if (k === ourKey) return "us";
      if (!names.has(k)) names.set(k, e.team);
      return k;
    });
  return { scores: scoreTeams(order), names };
}

/**
 * Where a place stands against the award lines (best first): the line it makes, and
 * how many places it is from the next better one ("2 from first team").
 */
export function awardStatus(place: number, awards: AwardLine[]): { made: AwardLine | null; next: { line: AwardLine; places: number } | null } {
  const lines = [...awards].sort((a, b) => a.through - b.through);
  const i = lines.findIndex((l) => place <= l.through);
  const made = i >= 0 ? lines[i] : null;
  const better = i > 0 ? lines[i - 1] : i < 0 ? (lines.at(-1) ?? null) : null;
  return { made, next: better ? { line: better, places: place - better.through } : null };
}

/** A team name as results print it, for matching: "Kimberly High School" → "kimberly". */
export function teamKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\./g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(high school|senior high|high|school|hs|sr|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The tracked team a results line belongs to, if any. */
export function trackedTeamFor(name: string | null, teams: TrackedTeam[]): TrackedTeam | null {
  if (!name) return null;
  const k = teamKey(name);
  return teams.find((t) => [t.name, ...t.aliases].some((n) => teamKey(n) === k)) ?? null;
}

/** Our school as places show it: the short name in full where there's room, a button label where not. */
export type OurTeam = { name: string; short: string };
export const ourTeamOf = (school: { shortName: string } | null): OurTeam => ({ name: school?.shortName ?? "Our team", short: school ? shortLabel(school.shortName) : "US" });

/** A button label: "KIM" for "Kimberly", initials for several words ("Little Chute" → "LC"). */
export function shortLabel(name: string): string {
  const words = teamKey(name).split(" ").filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 4) : words[0].slice(0, 3)).toUpperCase();
}

/** Button colors for tracked teams: a solid background with readable text in light and dark. */
export const PLACE_COLORS: Record<string, { label: string; bg: string; ink: string }> = {
  blue: { label: "Blue", bg: "#1d4ed8", ink: "#ffffff" },
  red: { label: "Red", bg: "#b91c1c", ink: "#ffffff" },
  orange: { label: "Orange", bg: "#c2410c", ink: "#ffffff" },
  gold: { label: "Gold", bg: "#ca8a04", ink: "#1c1917" },
  green: { label: "Green", bg: "#15803d", ink: "#ffffff" },
  purple: { label: "Purple", bg: "#7e22ce", ink: "#ffffff" },
  maroon: { label: "Maroon", bg: "#7f1d1d", ink: "#ffffff" },
  navy: { label: "Navy", bg: "#1e3a8a", ink: "#ffffff" },
  black: { label: "Black", bg: "#171717", ink: "#ffffff" },
  gray: { label: "Gray", bg: "#6b7280", ink: "#ffffff" },
};
export const placeColor = (key: string) => PLACE_COLORS[key] ?? PLACE_COLORS.gray;

/** Varsity defaults (a conference meet's all-conference lines); edited per race. */
export const DEFAULT_AWARDS: AwardLine[] = [
  { through: 10, label: "First team" },
  { through: 20, label: "Second team" },
  { through: 30, label: "Honorable mention" },
];

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
