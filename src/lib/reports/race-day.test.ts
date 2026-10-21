import { expect, test } from "vitest";
import type { HistoryRow } from "./history";
import { shortMeetName } from "./season-times";
import { buildRaceDay } from "./race-day";

const MILE = 1609.344;
const row = (athleteId: string, meetId: string, meetName: string, date: string, ms: number, extra: Partial<HistoryRow> = {}): HistoryRow => ({
  athleteId,
  meetId,
  meetName,
  meetShort: shortMeetName(meetName),
  date,
  seasonId: date.startsWith("2026") ? "s26" : "s25",
  courseId: null,
  series: meetName,
  raceId: `${meetId}-${athleteId}`,
  raceName: "Boys Varsity",
  levelId: "varsity",
  distanceId: "5k",
  status: "finished",
  finishMs: ms,
  precision: "tenths",
  place: 1,
  grade: null,
  wholeField: false,
  fieldSize: null,
  splits: [
    { label: "Mile 1", meters: MILE, ms: Math.round(ms * 0.31) },
    { label: "Mile 2", meters: 2 * MILE, ms: Math.round(ms * 0.64) },
  ],
  counts: true,
  ...extra,
});

test("race day: same meet last year, this course this season, last race; bests; splits on the clock", () => {
  const rows = [
    row("a", "sect25", "WIAA Division 3 Sectional", "2025-10-25", 1_050_000, { courseId: "home" }),
    row("a", "cty26", "Sheboygan County Meet", "2026-09-29", 1_030_000, { courseId: "home" }),
    row("a", "be26", "Big East Conference Championship", "2026-10-17", 1_000_000, { courseId: "hilbert" }),
    row("b", "be26", "Big East Conference Championship", "2026-10-17", 1_100_000, { courseId: "hilbert", levelId: "jv" }),
    row("b", "old", "Smiley Invite", "2025-09-01", 990_000), // career best last season, at another meet
    row("a", "today", "WIAA Division 3 Sectional", "2026-10-24", 900_000), // today's own result never counts
  ];
  const { refs, rows: out } = buildRaceDay({
    meet: { id: "today", date: "2026-10-24", seasonId: "s26", courseId: "home", series: "WIAA Division 3 Sectional" },
    checkpoints: [
      { label: "Mile 1", meters: MILE },
      { label: "Mile 2", meters: 2 * MILE },
    ],
    athleteIds: ["a", "b"],
    rows,
    distanceId: "5k",
  });
  expect(refs).toEqual([
    { meetId: "sect25", label: "'25 Sectional", note: "this course" },
    { meetId: "cty26", label: "'26 Sheboygan", note: "this course" },
    { meetId: "be26", label: "'26 Big East", note: "last race" },
  ]);
  expect(out.map((r) => [r.athleteId, r.careerBest, r.seasonBest])).toEqual([
    ["a", 1_000_000, 1_000_000],
    ["b", 990_000, 1_100_000],
  ]);
  expect(out[0].refs[0]).toEqual({ splits: [325_500, 672_000], finishMs: 1_050_000, jv: false });
  expect(out[1].refs).toEqual([null, null, { splits: [341_000, 704_000], finishMs: 1_100_000, jv: true }]);
});
