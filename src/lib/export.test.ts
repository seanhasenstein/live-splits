import { expect, test } from "vitest";
import { buildExportRows, formatWorkbookTime, toCsv } from "./export";
import type { Race } from "./db/schema";
import { replay, replayStatuses, type TapLike } from "./replay";

const race: Pick<Race, "levelIds" | "gunTimeMs" | "checkpoints"> = {
  levelIds: ["varsity", "jv"],
  gunTimeMs: 1_000_000,
  checkpoints: [
    { id: "m1", label: "Mile 1", distance: { value: 1, unit: "mi", meters: 1609.344 }, kind: "split" },
    { id: "m2", label: "Mile 2", distance: { value: 2, unit: "mi", meters: 3218.688 }, kind: "split" },
    { id: "fin", label: "Finish", distance: { value: 5, unit: "km", meters: 5000 }, kind: "finish" },
  ],
};

const tap = (clientTapId: string, p: Partial<TapLike> & { type: TapLike["type"] }): TapLike => ({
  clientTapId,
  checkpointId: "m1",
  athleteId: null,
  targetTapId: null,
  serverTimeMs: 0,
  timeMs: null,
  estimate: false,
  missed: false,
  ...p,
});

const athletes = [
  { _id: "A", displayName: "Eddy Giebler", graduationYear: 2028, gender: "M" as const, levelId: "varsity", grade: 11 },
  { _id: "B", displayName: "Nate Vanic", graduationYear: 2029, gender: "M" as const, levelId: "jv", grade: 10 },
  { _id: "C", displayName: "Titus Gottschalk", graduationYear: 2027, gender: "M" as const, levelId: "varsity", grade: 12 },
];

test("workbook layout: header, m:ss truncation, ordering, flags", () => {
  const taps = [
    tap("1", { type: "name_tap", athleteId: "A", serverTimeMs: 1_000_000 + 5 * 60_000 + 900 }), // 5:00.9 -> 5:00
    tap("2", { type: "name_tap", athleteId: "A", checkpointId: "m2", serverTimeMs: 1_000_000 + 10 * 60_000 + 36_000 }),
    tap("3", { type: "name_tap", athleteId: "A", checkpointId: "fin", serverTimeMs: 1_000_000 + 16 * 60_000 + 41_800 }),
    tap("4", { type: "name_tap", athleteId: "C", serverTimeMs: 1_000_000 + 5 * 60_000 + 19_000, timeMs: 1_000_000 + 5 * 60_000 + 19_000, estimate: true }),
    tap("5", { type: "name_tap", athleteId: "B", serverTimeMs: 1_000_000 + 5 * 60_000 + 53_000 }),
    tap("6", { type: "edit", targetTapId: "5", timeMs: 1_000_000 + 5 * 60_000 + 52_000, serverTimeMs: 2_000_000 }),
  ];
  const rows = buildExportRows({ race, state: replay(race, taps), athletes, levelLabel: (id) => (id === "jv" ? "JV" : "Varsity") });
  expect(rows[0].slice(0, 13)).toEqual([
    "Race", "Place", "Athlete", "Gr", "Official Finish", "Finish", "Mile 1 (cumulative)", "Mile 2 (cumulative)",
    "Previous SB", "Prev SB Meet", "New SB?", "Change", "Letter?",
  ]);
  expect(rows[0].slice(13)).toEqual(["Finish Flag", "Mile 1 Flag", "Mile 2 Flag"]);
  // Varsity first (Eddy finished, Titus only Mile 1), then JV.
  expect(rows.slice(1).map((r) => r[2])).toEqual(["Eddy Giebler", "Titus Gottschalk", "Nate Vanic"]);
  expect(rows[1].slice(0, 8)).toEqual(["Varsity", "", "Eddy Giebler", "11", "", "16:41", "5:00", "10:36"]);
  expect(rows[2][6]).toBe("5:19");
  expect(rows[2][14]).toBe("estimate");
  expect(rows[3][6]).toBe("5:52");
  expect(rows[3][14]).toBe("edited");
});

test("no gun: times blank but rows still present", () => {
  const rows = buildExportRows({ race: { ...race, gunTimeMs: null }, state: replay(race, []), athletes, levelLabel: (id) => id });
  expect(rows).toHaveLength(4);
  expect(rows[1][5]).toBe("");
});

test("csv quoting", () => {
  expect(toCsv([["a", 'b "q"', "c,d"]])).toBe('a,"b ""q""","c,d"\r\n');
  // A name that would run as a formula in Excel stays text; signed numbers stay numbers.
  expect(toCsv([['=HYPERLINK("x")', "+Fast", "-1", "+2", "1:12"]])).toBe(`"'=HYPERLINK(""x"")",'+Fast,-1,+2,1:12\r\n`);
  expect(formatWorkbookTime(61_999)).toBe("1:01");
});

test("app DNS / DNF land in the Place and Finish columns when there is no official result", () => {
  const taps = [
    tap("1", { type: "name_tap", athleteId: "A", serverTimeMs: 1_000_000 + 5 * 60_000 }),
    tap("2", { type: "status", athleteId: "A", status: "dnf", checkpointId: "m1", serverTimeMs: 1_000_000 + 9 * 60_000 }),
    tap("3", { type: "status", athleteId: "B", status: "dns", checkpointId: null, serverTimeMs: 1_000_000 }),
  ];
  const rows = buildExportRows({ race, state: replay(race, taps), statuses: replayStatuses(taps), athletes, levelLabel: (id) => id });
  const byName = Object.fromEntries(rows.slice(1).map((r) => [r[2], r]));
  expect(byName["Eddy Giebler"].slice(1, 7)).toEqual(["DNF", "Eddy Giebler", "11", "", "DNF", "5:00"]);
  expect(byName["Nate Vanic"].slice(1, 6)).toEqual(["DNS", "Nate Vanic", "10", "", "DNS"]);
  expect(byName["Titus Gottschalk"][5]).toBe("");
});

test("a combined race labels the Race column with the gender", () => {
  const mixed = [...athletes, { _id: "D", displayName: "Ella Heronymus", graduationYear: 2028, gender: "F" as const, levelId: "jv", grade: 11 }];
  const rows = buildExportRows({ race, state: replay(race, []), athletes: mixed, levelLabel: (id) => (id === "jv" ? "JV" : "Varsity"), combined: true });
  const byName = Object.fromEntries(rows.slice(1).map((r) => [r[2], r[0]]));
  expect(byName["Ella Heronymus"]).toBe("JV Girls");
  expect(byName["Nate Vanic"]).toBe("JV Boys");
});

test("official and app finishers sort together by time", () => {
  const gun = 1_000_000;
  const taps = [
    tap("1", { type: "name_tap", athleteId: "A", checkpointId: "fin", serverTimeMs: gun + 18 * 60_000 }), // app-only 18:00
  ];
  const official = { B: { finishMs: 22 * 60_000, status: "finished", place: 40, byCheckpoint: {}, precision: "tenths" as const } };
  const rows = buildExportRows({ race, state: replay(race, taps), athletes, levelLabel: (id) => id, official });
  const names = rows.slice(1).filter((r) => r[0] === "varsity").map((r) => r[2]);
  expect(names[0]).toBe("Eddy Giebler"); // A (18:00) before C (no time)
  const jv = rows.slice(1).filter((r) => r[0] === "jv").map((r) => r[2]);
  expect(jv).toEqual(["Nate Vanic"]);
  // Put B in varsity to compare directly with A
  const rows2 = buildExportRows({ race, state: replay(race, taps), athletes: athletes.map((a) => ({ ...a, levelId: "varsity" })), levelLabel: (id) => id, official });
  expect(rows2.slice(1).map((r) => r[2]).slice(0, 2)).toEqual(["Eddy Giebler", "Nate Vanic"]);
});
