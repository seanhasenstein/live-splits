import { segmentsAt } from "./athlete";
import type { HistoryRow } from "./history";

/**
 * The Athlete Profile (the team's profile PDF): a runner's seasons side by side, meet by meet. Meets
 * line up across years by series (the short name), in the order they fall in a season. Pure, so it
 * can be tested without a database.
 */

const sec = (ms: number) => Math.floor(ms / 1000);
const dayOfSeason = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 7, 1)) / 86_400_000);
};

export type ProfileSlot = { series: string; label: string };
export type ProfileCell = { raceId: string; meetId: string; ms: number | null; status: string; place: number | null; jv: boolean; letter: boolean; seasonBest: boolean; careerBest: boolean };
export type ProfileSeason = { seasonId: string; year: string; grade: number | null; cells: (ProfileCell | null)[] };
export type VsLast = {
  label: string;
  last: { segments: (number | null)[]; place: number | null; jv: boolean };
  now: { segments: (number | null)[]; place: number | null; jv: boolean };
  /** Now minus last, per stretch then the finish, in whole seconds (negative = faster). */
  delta: (number | null)[];
};

export type Profile = {
  slots: ProfileSlot[];
  /** Oldest season first. */
  seasons: ProfileSeason[];
  /** Slots still to come this season (shaded on the chart). */
  upcoming: boolean[];
  kpis: {
    careerBest: ProfileCell | null;
    bestPlace: { place: number; times: number } | null;
    /** Last season's best minus this season's (positive = faster now). */
    vsLastBest: number | null;
    sameMeet: { faster: number; of: number } | null;
    letters: { earned: number; of: number };
  };
  vsLast: VsLast[];
  /** Per stretch then the finish: the average change across vsLast. */
  average: (number | null)[];
  next: { label: string; name: string; history: { year: string; ms: number }[] } | null;
};

export function buildProfile(input: {
  /** This runner's races at the main distance, every season. */
  rows: HistoryRow[];
  seasons: { id: string; startDate: string }[];
  currentSeasonId: string;
  gradeFor: (seasonId: string) => number | null;
  /** Letter standard (ms) by meet, for this runner's gender. */
  letterMs: Record<string, number | undefined>;
  /** This season's meets, run or not, for slots still to come and what's next. */
  currentMeets: { id: string; name: string; series: string; label: string; date: string }[];
  today: string;
  checkpoints: { meters: number }[];
}): Profile {
  const rows = [...input.rows].sort((a, b) => a.date.localeCompare(b.date));
  const timed = rows.filter((r) => r.counts && r.finishMs !== null && r.status === "finished");

  // Slots: every series this runner ran or the season still holds, in season order (median day).
  const days = new Map<string, number[]>();
  const labels = new Map<string, { date: string; label: string }>();
  const note = (series: string, date: string, label: string) => {
    days.set(series, [...(days.get(series) ?? []), dayOfSeason(date)]);
    if (!labels.has(series) || labels.get(series)!.date < date) labels.set(series, { date, label });
  };
  for (const r of rows) note(r.series, r.date, r.meetShort);
  for (const m of input.currentMeets) note(m.series, m.date, m.label);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const slots = [...days.keys()].sort((a, b) => median(days.get(a)!) - median(days.get(b)!)).map((series) => ({ series, label: labels.get(series)!.label }));

  const careerBestRow = timed.reduce<HistoryRow | null>((b, r) => (b === null || r.finishMs! < b.finishMs! ? r : b), null);
  const seasonBestMs = new Map<string, number>();
  for (const r of timed) seasonBestMs.set(r.seasonId, Math.min(seasonBestMs.get(r.seasonId) ?? Infinity, r.finishMs!));
  const cellOf = (r: HistoryRow): ProfileCell => {
    const finished = r.status === "finished" && r.finishMs !== null;
    const std = input.letterMs[r.meetId];
    return {
      raceId: r.raceId,
      meetId: r.meetId,
      ms: finished ? r.finishMs : null,
      status: r.status,
      place: r.place,
      jv: r.levelId === "jv",
      letter: finished && std !== undefined && sec(r.finishMs!) <= sec(std),
      seasonBest: finished && r.counts && sec(r.finishMs!) === sec(seasonBestMs.get(r.seasonId) ?? Infinity),
      careerBest: !!careerBestRow && r.raceId === careerBestRow.raceId,
    };
  };

  const seasonOrder = [...input.seasons].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const seasons: ProfileSeason[] = seasonOrder
    .filter((s) => rows.some((r) => r.seasonId === s.id))
    .map((s) => ({
      seasonId: s.id,
      year: rows.find((r) => r.seasonId === s.id)!.date.slice(0, 4),
      grade: input.gradeFor(s.id),
      // Two races in one series in a season (rare): the faster.
      cells: slots.map((slot) => {
        const here = rows.filter((r) => r.seasonId === s.id && r.series === slot.series).sort((a, b) => (a.finishMs ?? Infinity) - (b.finishMs ?? Infinity))[0];
        return here ? cellOf(here) : null;
      }),
    }));

  const ran = new Set(rows.filter((r) => r.seasonId === input.currentSeasonId).map((r) => r.series));
  // Still to come: on this season's schedule ahead, or (not scheduled yet, like the sectional) usually later in a season than today.
  const todayInSeason = dayOfSeason(input.today);
  const upcoming = slots.map(
    (slot) => input.currentSeasonId !== "" && !ran.has(slot.series) && (input.currentMeets.some((m) => m.series === slot.series && m.date >= input.today) || median(days.get(slot.series)!) > todayInSeason),
  );

  const current = rows.filter((r) => r.seasonId === input.currentSeasonId);
  const currentTimed = current.filter((r) => r.status === "finished" && r.finishMs !== null);
  const prevSeason = [...seasonOrder].reverse().find((s) => s.startDate < (seasonOrder.find((x) => x.id === input.currentSeasonId)?.startDate ?? "") && rows.some((r) => r.seasonId === s.id));
  const prev = prevSeason ? rows.filter((r) => r.seasonId === prevSeason.id) : [];
  const places = currentTimed.map((r) => r.place).filter((p): p is number => p !== null);
  const bestPlace = places.length ? Math.min(...places) : null;
  const sbNow = seasonBestMs.get(input.currentSeasonId);
  const sbLast = prevSeason ? seasonBestMs.get(prevSeason.id) : undefined;

  // Meet by meet against last season: this season's races whose series this runner also ran last season.
  const vsLast: VsLast[] = [];
  let faster = 0;
  for (const r of currentTimed) {
    const before = prev.find((p) => p.series === r.series && p.status === "finished" && p.finishMs !== null);
    if (!before) continue;
    if (sec(r.finishMs!) < sec(before.finishMs!)) faster++;
    const a = segmentsAt(before, input.checkpoints);
    const b = segmentsAt(r, input.checkpoints);
    const whole = (ms: number | null) => (ms === null ? null : sec(ms));
    const delta = [...b.map((x, i) => (x !== null && a[i] !== null ? whole(x)! - whole(a[i])! : null)), sec(r.finishMs!) - sec(before.finishMs!)];
    vsLast.push({ label: r.meetShort, last: { segments: a, place: before.place, jv: before.levelId === "jv" }, now: { segments: b, place: r.place, jv: r.levelId === "jv" }, delta });
  }
  const average = vsLast.length === 0 ? [] : vsLast[0].delta.map((_, i) => {
    const xs = vsLast.map((v) => v.delta[i]).filter((x): x is number => x !== null);
    return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
  });

  const nextMeet = input.currentMeets.filter((m) => m.date >= input.today && !ran.has(m.series)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const next = nextMeet
    ? {
        label: nextMeet.label,
        name: nextMeet.name,
        history: rows
          .filter((r) => r.series === nextMeet.series && r.status === "finished" && r.finishMs !== null)
          .map((r) => ({ year: r.date.slice(0, 4), ms: r.finishMs! })),
      }
    : null;

  return {
    slots,
    seasons,
    upcoming,
    kpis: {
      careerBest: careerBestRow ? cellOf(careerBestRow) : null,
      bestPlace: bestPlace === null ? null : { place: bestPlace, times: places.filter((p) => p === bestPlace).length },
      vsLastBest: sbNow !== undefined && sbLast !== undefined ? sec(sbLast) - sec(sbNow) : null,
      sameMeet: vsLast.length ? { faster, of: vsLast.length } : null,
      letters: { earned: current.filter((r) => cellOf(r).letter).length, of: currentTimed.length },
    },
    vsLast,
    average,
    next,
  };
}
