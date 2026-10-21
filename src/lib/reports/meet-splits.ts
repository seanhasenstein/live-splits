import { fieldScores } from "@/lib/race-places";
import { ordinal, segmentsAt } from "./athlete";
import type { SheetSummary } from "@/lib/results/splits-history";
import type { HistoryRow } from "./history";

/**
 * Meet Splits (design/report-spec.md §4a): per gender, each race's team numbers and our runners'
 * mile splits, finish with its PR / SB badge, place and letter point; then who didn't run. Pure, so
 * the time rules can be tested without a database:
 * - times are whole seconds, truncated (compare `sec`, never ms);
 * - SB = fastest time this season entering the meet, PR = career best entering it; equal to the
 *   second counts; PR outranks SB; no badge without an earlier time to beat;
 * - letter standard = the time of the varsity finisher at floor(0.66 × varsity finishers); any of
 *   our finishers (JV too) at or under it earns a letter point.
 */

export const sec = (ms: number) => Math.floor(ms / 1000);

export function letterCutoffPlace(varsityFinishers: number): number {
  return Math.floor(0.66 * varsityFinishers);
}

export type SplitsRace = {
  id: string;
  name: string;
  /** Null for a race boys and girls run together. */
  gender: "M" | "F" | null;
  varsity: boolean;
  order: number;
  checkpoints: { meters: number }[];
  /** The split sheet's numbers, for a race whose field wasn't imported (history). */
  sheet?: SheetSummary | null;
};
/** The race's full field as imported (every team). */
export type FieldRow = { team: string | null; place: number | null; status: string; timeMs: number | null; ours: boolean };

export type SplitsRow = {
  athleteId: string;
  segments: (number | null)[];
  finishMs: number | null;
  status: string;
  badge: "pr" | "sb" | null;
  place: number | null;
  letter: boolean;
};
export type SplitsStats = {
  points: number;
  place: number;
  teams: number;
  runners: number | null;
  /** Place null when only the time is known (from the sheet's LETTER marks). */
  letter: { place: number | null; ms: number } | null;
  /** "Tied at 123 · 5th on the 6th-runner tiebreak" when another team scored the same. */
  note: string | null;
};
export type SplitsSection = { race: SplitsRace; stats: SplitsStats | null; rows: SplitsRow[] };

export function buildMeetSplits(input: {
  meet: { id: string; date: string; seasonId: string };
  races: SplitsRace[];
  fields: Record<string, FieldRow[]>;
  /** Every history row we have for the roster (all meets); this meet's rows are its results. */
  rows: HistoryRow[];
  roster: { id: string; gender: string }[];
  athleteGender: Record<string, string>;
}): Record<"M" | "F", { sections: SplitsSection[]; didNotRun: string[] }> {
  const { meet } = input;
  const out = { M: { sections: [] as SplitsSection[], didNotRun: [] as string[] }, F: { sections: [] as SplitsSection[], didNotRun: [] as string[] } };
  const before = input.rows.filter((r) => r.counts && r.finishMs !== null && r.date < meet.date && r.meetId !== meet.id);
  const best = (athleteId: string, seasonOnly: boolean) => {
    let b: number | null = null;
    for (const r of before) if (r.athleteId === athleteId && (!seasonOnly || r.seasonId === meet.seasonId) && (b === null || r.finishMs! < b)) b = r.finishMs;
    return b;
  };

  // Each gender's letter standard, from its varsity race.
  const letterFor: Partial<Record<"M" | "F", { place: number | null; ms: number; runners: number | null }>> = {};
  for (const race of input.races) {
    if (!race.varsity || race.gender === null) continue;
    const standard = letterStandard(input.fields[race.id] ?? [], race.sheet ?? null);
    if (standard) letterFor[race.gender] = standard;
  }

  const races = [...input.races].sort((a, b) => Number(b.varsity) - Number(a.varsity) || a.order - b.order);
  for (const race of races) {
    const mine = input.rows.filter((r) => r.meetId === meet.id && r.raceId === race.id);
    for (const g of ["M", "F"] as const) {
      if (race.gender !== null && race.gender !== g) continue;
      const rows = mine
        .filter((r) => (input.athleteGender[r.athleteId] ?? race.gender) === g)
        .map((r): SplitsRow => {
          const finished = r.status === "finished" && r.finishMs !== null;
          const pr = best(r.athleteId, false);
          const sb = best(r.athleteId, true);
          const badge = !finished || !r.counts ? null : pr !== null && sec(r.finishMs!) <= sec(pr) ? "pr" : sb !== null && sec(r.finishMs!) <= sec(sb) ? "sb" : null;
          const standard = letterFor[g];
          return {
            athleteId: r.athleteId,
            segments: segmentsAt(r, race.checkpoints),
            finishMs: finished ? r.finishMs : null,
            status: r.status,
            badge,
            place: r.place,
            letter: finished && !!standard && sec(r.finishMs!) <= sec(standard.ms),
          };
        })
        // Finishers by place, then the rest.
        .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || (a.finishMs ?? Infinity) - (b.finishMs ?? Infinity));
      if (rows.length === 0) continue;
      out[g].sections.push({ race, stats: race.gender === null ? null : statsFor(race, input.fields[race.id] ?? [], letterFor[g]), rows });
    }
  }

  // Did not run: on the roster, but no result anywhere in this meet.
  const ran = new Set(input.rows.filter((r) => r.meetId === meet.id).map((r) => r.athleteId));
  for (const a of input.roster) if (!ran.has(a.id) && (a.gender === "M" || a.gender === "F")) out[a.gender].didNotRun.push(a.id);
  return out;
}

/** Whether a field is a whole field (other teams' runners imported), not just ours. */
const wholeField = (field: FieldRow[]) => field.some((e) => !e.ours);

/**
 * A varsity race's letter standard. The split sheet's, when it printed one: that's what the team
 * published and awarded (and older seasons didn't always use today's formula). Otherwise, from the
 * whole field: the time of the finisher at floor(0.66 × finishers). Null when neither is known.
 */
export function letterStandard(field: FieldRow[], sheet: SheetSummary | null): { place: number | null; ms: number; runners: number | null } | null {
  if (sheet?.letter) return { place: sheet.letter.place, ms: sheet.letter.ms, runners: sheet.runners };
  if (!wholeField(field)) return null;
  const finishers = field.filter((e) => e.status === "finished" && e.place !== null && e.timeMs !== null).sort((a, b) => a.place! - b.place!);
  const place = letterCutoffPlace(finishers.length);
  return place >= 1 ? { place, ms: finishers[place - 1].timeMs!, runners: finishers.length } : null;
}

/**
 * Team points, place and number of scoring teams; field size and letter standard for varsity. From
 * the whole field when it was imported, else from the split sheet's numbers. Null without a team score.
 */
function statsFor(race: SplitsRace, field: FieldRow[], letter: { place: number | null; ms: number; runners: number | null } | undefined): SplitsStats | null {
  if (!wholeField(field)) {
    const s = race.sheet;
    if (!s || s.points === null || s.place === null || s.teams === null) return null;
    return { points: s.points, place: s.place, teams: s.teams, runners: race.varsity ? s.runners : null, letter: race.varsity && letter ? { place: letter.place, ms: letter.ms } : null, note: null };
  }
  const { scores } = fieldScores(field.map((e) => ({ team: e.team, place: e.place, status: e.status, ours: e.ours })));
  const scoring = scores.filter((s) => s.points !== null);
  const i = scoring.findIndex((s) => s.team === "us");
  if (i < 0 || scoring.length < 2) return null;
  const points = scoring[i].points!;
  const tied = scoring.some((s, k) => k !== i && s.points === points);
  return {
    points,
    place: i + 1,
    teams: scoring.length,
    runners: race.varsity ? (letter?.runners ?? null) : null,
    letter: race.varsity && letter ? { place: letter.place, ms: letter.ms } : null,
    note: tied ? `Tied at ${points} · ${ordinal(i + 1)} on the 6th-runner tiebreak` : null,
  };
}
