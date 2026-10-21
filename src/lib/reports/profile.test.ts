import { expect, test } from "vitest";
import type { HistoryRow } from "./history";
import { buildProfile } from "./profile";

const MILE = 1609.344;
const row = (series: string, date: string, ms: number, extra: Partial<HistoryRow> = {}): HistoryRow => ({
  athleteId: "a",
  meetId: `${series}-${date}`,
  meetName: series,
  meetShort: series,
  date,
  seasonId: `s${date.slice(0, 4)}`,
  courseId: null,
  series,
  raceId: `${series}-${date}-r`,
  raceName: "Boys Varsity",
  levelId: "varsity",
  distanceId: "5k",
  status: "finished",
  finishMs: ms,
  precision: "tenths",
  place: 5,
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

test("profile: slots in season order across years, season and career bests, meet by meet vs last season, letters, next up", () => {
  const rows = [
    row("KML", "2025-08-28", 1_075_000, { place: 6 }),
    row("County", "2025-09-30", 1_050_000, { place: 1 }),
    row("KML", "2026-08-27", 1_051_000, { place: 1 }),
    row("Smiley", "2026-09-19", 1_000_000, { place: 1 }),
    row("County", "2026-09-29", 1_049_500, { place: 1 }),
  ];
  const p = buildProfile({
    rows,
    seasons: [
      { id: "s2025", startDate: "2025-08-01" },
      { id: "s2026", startDate: "2026-08-01" },
    ],
    currentSeasonId: "s2026",
    gradeFor: (id) => (id === "s2026" ? 11 : 10),
    letterMs: { "KML-2026-08-27": 1_060_000, "County-2026-09-29": 1_040_000 },
    currentMeets: [
      { id: "lux", name: "Lux-Casco Russ Fameree XC Classic", series: "Lux", label: "Lux", date: "2026-10-09" },
      { id: "x", name: "County Meet", series: "County", label: "County", date: "2026-09-29" },
    ],
    today: "2026-10-03",
    checkpoints: [{ meters: MILE }, { meters: 2 * MILE }],
  });
  expect(p.slots.map((s) => s.label)).toEqual(["KML", "Smiley", "County", "Lux"]);
  expect(p.seasons.map((s) => [s.year, s.grade, s.cells.map((c) => (c ? c.ms : null))])).toEqual([
    ["2025", 10, [1_075_000, null, 1_050_000, null]],
    ["2026", 11, [1_051_000, 1_000_000, 1_049_500, null]],
  ]);
  expect(p.upcoming).toEqual([false, false, false, true]);
  const now = p.seasons[1].cells;
  expect(now.map((c) => [c?.letter, c?.seasonBest, c?.careerBest])).toEqual([
    [true, false, false],
    [false, true, true], // no letter standard on file for Smiley
    [false, false, false], // 17:29 is over County's 17:20
    [undefined, undefined, undefined],
  ]);
  expect(p.kpis).toMatchObject({ bestPlace: { place: 1, times: 3 }, vsLastBest: 1050 - 1000, sameMeet: { faster: 2, of: 2 }, letters: { earned: 1, of: 3 } });
  expect(p.vsLast.map((v) => [v.label, v.delta.at(-1)])).toEqual([
    ["KML", 1051 - 1075],
    ["County", 1049 - 1050],
  ]);
  expect(p.average.at(-1)).toBe(Math.round((-24 - 1) / 2));
  expect(p.next).toEqual({ label: "Lux", name: "Lux-Casco Russ Fameree XC Classic", history: [] });
});

test("profile: a meet run in earlier seasons but not on this season's schedule yet is still to come when it falls later in a season", () => {
  const p = buildProfile({
    rows: [row("KML", "2025-08-28", 1_075_000), row("Sectional", "2025-10-25", 1_040_000), row("KML", "2026-08-27", 1_051_000), row("Conference", "2025-10-04", 1_050_000)],
    seasons: [
      { id: "s2025", startDate: "2025-08-01" },
      { id: "s2026", startDate: "2026-08-01" },
    ],
    currentSeasonId: "s2026",
    gradeFor: () => null,
    letterMs: {},
    currentMeets: [],
    today: "2026-10-21",
    checkpoints: [],
  });
  expect(p.slots.map((s) => s.label)).toEqual(["KML", "Conference", "Sectional"]);
  expect(p.upcoming).toEqual([false, false, true]);
});
