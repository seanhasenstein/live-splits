import { expect, test } from "vitest";
import { ordinal, segmentsAt, summarizeAthlete, worthKnowing } from "./athlete";
import type { HistoryRow } from "./history";
import { shortMeetName } from "./season-times";

const MILE = 1609.344;
const row = (athleteId: string, raceId: string, meetName: string, date: string, ms: number, extra: Partial<HistoryRow> = {}): HistoryRow => ({
  athleteId,
  meetId: raceId,
  meetName,
  meetShort: shortMeetName(meetName),
  date,
  seasonId: `s${date.slice(0, 4)}`,
  courseId: null,
  series: meetName,
  raceId,
  raceName: "Boys Varsity",
  levelId: "varsity",
  distanceId: "5k",
  status: "finished",
  finishMs: ms,
  precision: "tenths",
  place: 10,
  grade: null,
  fieldSize: 80,
  splits: [
    { label: "Mile 1", meters: MILE, ms: 330_000 },
    { label: "Mile 2", meters: 2 * MILE, ms: 680_000 },
  ],
  counts: true,
  ...extra,
});

const rows = [
  row("a", "sect25", "Sectional", "2025-10-25", 1_080_000, { courseId: "home", place: 12 }),
  row("a", "kml26", "Kettle Moraine Lutheran Invite", "2026-08-28", 1_100_000),
  row("a", "cty26", "County", "2026-09-29", 1_040_000, { courseId: "home" }),
  row("a", "be26", "Big East", "2026-10-17", 1_020_000),
  row("b", "cty26", "County", "2026-09-29", 1_060_000, { courseId: "home" }),
  row("b", "be26", "Big East", "2026-10-17", 1_050_000),
  row("a", "sect26", "Sectional", "2026-10-24", 990_000, { courseId: "home" }), // the meet being previewed
];

test("athlete summary: segments, team place, change from the race before, bests, this course", () => {
  const s = summarizeAthlete({ athleteId: "a", rows, teamRows: rows, distanceId: "5k", seasonId: "s2026", courseId: "home", before: "2026-10-24" });
  expect(s.races.map((r) => r.label)).toEqual(["'25 Sectional", "'26 KML", "'26 County", "'26 Big East"]);
  expect(segmentsAt(s.races[3], [{ meters: MILE }, { meters: 2 * MILE }])).toEqual([330_000, 350_000, 340_000]);
  expect(s.races[2].teamPlace).toEqual({ place: 1, of: 2 });
  expect(s.races.map((r) => r.vsPrev)).toEqual([null, 20_000, -60_000, -20_000]);
  expect([s.careerBest?.raceId, s.seasonBest?.raceId, s.lastRace?.raceId, s.courseBest?.raceId]).toEqual(["be26", "be26", "be26", "cty26"]);
  expect(s.onCourse.map((r) => r.raceId)).toEqual(["sect25", "cty26"]);
  expect(s.races.filter((r) => r.pr || r.sb).map((r) => r.raceId)).toEqual(["be26"]);
});

test("worth knowing: last year here vs this season, first-runner streak, progress since the first race", () => {
  const s = summarizeAthlete({ athleteId: "a", rows, teamRows: rows, distanceId: "5k", seasonId: "s2026", courseId: "home", before: "2026-10-24" });
  expect(worthKnowing(s, { series: "Sectional", team: "Crusader" })).toEqual([
    "Ran 18:00 here in 2025 (12th). This season's best, 17:00, is 1:00 faster.",
    "First Crusader runner across the line in each of the last 2 races.",
    "1:20 faster than the first race of the season (18:20 at KML).",
  ]);
  const b = summarizeAthlete({ athleteId: "b", rows, teamRows: rows, distanceId: "5k", seasonId: "s2026", courseId: "home", before: "2026-10-24" });
  expect(worthKnowing(b, { series: "Sectional", team: "Crusader" })[0]).toBe("First time running this meet.");
});

test("ordinals", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
});

test("segments line up with today's checkpoints; a missing or impossible split leaves a gap, not a wrong number", () => {
  const cps = [{ meters: MILE }, { meters: 2 * MILE }];
  expect(segmentsAt({ splits: [], finishMs: 1_200_000, status: "finished" }, cps)).toEqual([null, null, null]);
  expect(segmentsAt({ splits: [{ label: "Mile 2", meters: 2 * MILE, ms: 700_000 }], finishMs: 1_100_000, status: "finished" }, cps)).toEqual([null, null, 400_000]);
  expect(
    segmentsAt(
      {
        splits: [
          { label: "Mile 1", meters: MILE, ms: 400_000 },
          { label: "Mile 2", meters: 2 * MILE, ms: 313_000 },
        ],
        finishMs: 1_200_000,
        status: "finished",
      },
      cps,
    ),
  ).toEqual([400_000, null, null]);
  expect(segmentsAt({ splits: [{ label: "Mile 1", meters: MILE, ms: 400_000 }], finishMs: null, status: "dnf" }, cps)).toEqual([400_000, null, null]);
});
