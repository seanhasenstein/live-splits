import { expect, test } from "vitest";
import { allTimeRank, isStateMeet, rankLabel, rankRows } from "./all-time";

test("rank to the whole second, ties sharing: an old 17:24 and a new 17:24.8 tie", () => {
  expect(allTimeRank(1_044_800, [1_044_000, 1_000_000, 1_100_000])).toBe(2);
  expect(allTimeRank(990_000, [1_044_000, 1_000_000])).toBe(1);
  const rows = rankRows([
    { name: "B", year: 2010, grade: 12, timeMs: 1_044_000, timeText: "17:24", place: 20, athleteId: null, current: false },
    { name: "A", year: 2026, grade: 11, timeMs: 1_044_800, timeText: null, place: 18, athleteId: "a", current: true },
    { name: "C", year: 2015, grade: 10, timeMs: 1_000_000, timeText: "16:40", place: 5, athleteId: null, current: false },
  ]);
  expect(rows.map((r) => [r.rank, r.name])).toEqual([
    [1, "C"],
    [2, "B"],
    [2, "A"],
  ]);
});

test("State meet: by short name or by name", () => {
  expect(isStateMeet({ shortName: "State", name: "WIAA Division 3 State Championships" })).toBe(true);
  expect(isStateMeet({ shortName: null, name: "WIAA State Meet @ The Ridges" })).toBe(true);
  expect(isStateMeet({ shortName: "Sect", name: "WIAA Sectional" })).toBe(false);
  expect(rankLabel(7)).toBe("#7 all-time at State");
  expect(rankLabel(3, 4000)).toBe("#3 all-time at State (4K)");
});

test("State meet names WIAA uses", () => {
  expect(isStateMeet({ name: "WIAA State Cross Country Championships" })).toBe(true);
  expect(isStateMeet({ name: "Pike Lake State Park Invite" })).toBe(false);
  expect(isStateMeet({ name: "Kettle Moraine Lutheran Invite" })).toBe(false);
});
