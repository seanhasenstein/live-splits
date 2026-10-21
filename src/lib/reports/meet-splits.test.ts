import { expect, test } from "vitest";
import type { HistoryRow } from "./history";
import { buildMeetSplits, type FieldRow, letterCutoffPlace, sec } from "./meet-splits";

test("letter cutoff: floor(0.66 × varsity finishers)", () => {
  expect(letterCutoffPlace(143)).toBe(94);
  expect(letterCutoffPlace(64)).toBe(42);
  expect(letterCutoffPlace(79)).toBe(52);
  expect(letterCutoffPlace(73)).toBe(48);
  expect(letterCutoffPlace(1)).toBe(0);
});

test("times truncate to whole seconds", () => {
  expect(sec(1_012_900)).toBe(1012); // 16:52.9 → 16:52
  expect(sec(1_013_000)).toBe(1013);
});

const MILE = 1609.344;
const row = (athleteId: string, meetId: string, date: string, ms: number, extra: Partial<HistoryRow> = {}): HistoryRow => ({
  athleteId,
  meetId,
  meetName: meetId,
  meetShort: meetId,
  date,
  seasonId: `s${date.slice(0, 4)}`,
  courseId: null,
  series: meetId,
  raceId: `${meetId}-bv`,
  raceName: "Boys Varsity",
  levelId: "varsity",
  distanceId: "5k",
  status: "finished",
  finishMs: ms,
  precision: "tenths",
  place: 5,
  grade: 11,
  fieldSize: null,
  splits: [
    { label: "Mile 1", meters: MILE, ms: 310_000 },
    { label: "Mile 2", meters: 2 * MILE, ms: 640_000 },
  ],
  counts: true,
  ...extra,
});

// A varsity field of 20 finishers, 5 of ours and two full other teams: the letter standard is the
// 13th finisher's time (floor(13.2) = 13), 960 s + 12 × 20 s = 20:00.
const OURS = [2, 7, 12, 14, 16];
const field = (): FieldRow[] =>
  Array.from({ length: 20 }, (_, i) => ({ team: OURS.includes(i + 1) ? "Sheboygan Area Lutheran" : `Team ${i % 2}`, place: i + 1, status: "finished", timeMs: 960_000 + i * 20_000, ours: OURS.includes(i + 1) }));

test("meet splits: SB matching to the second, PR outranks SB, letter at or under the standard (JV too), did not run", () => {
  const meet = { id: "m", date: "2026-10-17", seasonId: "s2026" };
  const rows = [
    row("a", "earlier", "2026-09-01", 1_000_400), // a's SB coming in: 16:40.4
    row("a", "lastyear", "2025-10-01", 990_000), // a's PR coming in: 16:30.0
    row("a", "m", "2026-10-17", 1_000_900, { place: 2 }), // 16:40.9: equal to the SB to the second → SB, not a PR
    row("b", "lastyear", "2025-10-01", 1_100_000),
    row("b", "m", "2026-10-17", 1_090_000, { place: 7 }), // under b's PR → PR
    row("c", "m", "2026-10-17", 1_200_999, { raceId: "m-bjv", levelId: "jv", place: 1 }), // JV, 20:00.9 → 20:00, at the standard
    row("e", "m", "2026-10-17", 1_201_000, { raceId: "m-bjv", levelId: "jv", place: 2 }), // JV, 20:01: just over
  ];
  const out = buildMeetSplits({
    meet,
    races: [
      { id: "m-bv", name: "Boys Varsity", gender: "M", varsity: true, order: 1, checkpoints: [{ meters: MILE }, { meters: 2 * MILE }] },
      { id: "m-bjv", name: "Boys JV", gender: "M", varsity: false, order: 2, checkpoints: [{ meters: MILE }, { meters: 2 * MILE }] },
    ],
    fields: { "m-bv": field() },
    rows,
    roster: [
      { id: "a", gender: "M" },
      { id: "b", gender: "M" },
      { id: "c", gender: "M" },
      { id: "d", gender: "M" },
      { id: "e", gender: "M" },
    ],
    athleteGender: { a: "M", b: "M", c: "M", d: "M", e: "M" },
  });
  const [bv, bjv] = out.M.sections;
  expect(bv.rows.map((r) => [r.athleteId, r.badge, r.letter])).toEqual([
    ["a", "sb", true],
    ["b", "pr", true],
  ]);
  expect(bv.rows[0].segments).toEqual([310_000, 330_000, 360_900]);
  // Team points and place come from the usual scoring (tested with it); here: three scoring teams, ours third.
  expect(bv.stats).toEqual({ points: 51, place: 3, teams: 3, runners: 20, letter: { place: 13, ms: 1_200_000 }, note: null });
  expect(bjv.rows.map((r) => [r.athleteId, r.badge, r.letter])).toEqual([
    ["c", null, true], // first race on file: no badge
    ["e", null, false],
  ]);
  expect(bjv.stats).toBeNull(); // no JV field imported: no team numbers
  expect(out.M.didNotRun).toEqual(["d"]);
});

test("a tie in points says so, with where the 6th-runner tiebreak put us", () => {
  // Two teams of seven, both 29 points: us 1,2,4,10,12 (6th: 13) · them 3,5,6,7,8 (6th: 9), so they win the tiebreak.
  const ours = [1, 2, 4, 10, 12, 13, 14];
  const field: FieldRow[] = Array.from({ length: 14 }, (_, i) => ({ team: ours.includes(i + 1) ? "Us" : "Them", place: i + 1, status: "finished", timeMs: 1_000_000 + i * 1000, ours: ours.includes(i + 1) }));
  const out = buildMeetSplits({
    meet: { id: "m", date: "2026-10-17", seasonId: "s2026" },
    races: [{ id: "m-bv", name: "Boys Varsity", gender: "M", varsity: true, order: 1, checkpoints: [] }],
    fields: { "m-bv": field },
    rows: [row("a", "m", "2026-10-17", 1_000_000, { place: 1 })],
    roster: [{ id: "a", gender: "M" }],
    athleteGender: { a: "M" },
  });
  expect(out.M.sections[0].stats).toMatchObject({ points: 29, place: 2, teams: 2, note: "Tied at 29 · 2nd on the 6th-runner tiebreak" });
});

test("without the whole field (a history import), team numbers and the letter standard come from the split sheet", () => {
  const out = buildMeetSplits({
    meet: { id: "m", date: "2026-10-17", seasonId: "s2026" },
    races: [
      {
        id: "m-bv",
        name: "Boys Varsity",
        gender: "M",
        varsity: true,
        order: 1,
        checkpoints: [],
        sheet: { points: 76, place: 2, teams: 12, runners: 79, letter: { place: 52, ms: 19 * 60_000 + 47_000 } },
      },
    ],
    // Only our own runner on file.
    fields: { "m-bv": [{ team: "Us", place: 34, status: "finished", timeMs: 1_113_000, ours: true }] },
    rows: [row("a", "m", "2026-10-17", 1_113_000, { place: 34 })],
    roster: [{ id: "a", gender: "M" }],
    athleteGender: { a: "M" },
  });
  const [bv] = out.M.sections;
  expect(bv.stats).toEqual({ points: 76, place: 2, teams: 12, runners: 79, letter: { place: 52, ms: 1_187_000 }, note: null });
  expect(bv.rows[0].letter).toBe(true); // 18:33 under 19:47
});
