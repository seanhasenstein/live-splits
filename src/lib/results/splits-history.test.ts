import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { METERS_PER_MILE } from "@/lib/pace";
import { parseLongDate, parseSplitsHistory, sheetSummaryFor } from "./splits-history";

const text = readFileSync(`${process.cwd()}/src/lib/results/fixtures/splits-history.txt`, "utf8");

test("long dates", () => {
  expect(parseLongDate("August 28th 2025")).toBe("2025-08-28");
  expect(parseLongDate("September 3, 2024")).toBe("2024-09-03");
  expect(parseLongDate("Oct 2nd 2026")).toBe("2026-10-02");
  expect(parseLongDate("28 August 2025")).toBeNull();
});

test("a meet's two tables become one meet with splits, finishes, places, levels, DNFs; blank rows are skipped", () => {
  const meets = parseSplitsHistory(text);
  expect(meets).toHaveLength(1);
  const m = meets[0];
  expect(m.name).toBe("Kettle Moraine Lutheran Invite");
  expect(m.date).toBe("2025-08-28");
  expect(m.checkpoints).toEqual([
    { label: "Mile 1", meters: METERS_PER_MILE },
    { label: "Mile 2", meters: 2 * METERS_PER_MILE },
  ]);
  expect(m.distanceMeters).toBe(5000);
  expect(m.summaries).toHaveLength(3);
  expect(m.rows).toHaveLength(21); // 27 names, 6 didn't run

  const titus = m.rows.find((r) => r.name === "Titus Gottschalk")!;
  expect(titus).toMatchObject({ gender: "M", level: "varsity", finishMs: 18 * 60_000 + 13_000, place: 11, status: "finished", letter: true });
  expect(titus.splits).toEqual({ "Mile 1": 5 * 60_000 + 46_000, "Mile 2": 11 * 60_000 + 47_000 }); // 5:46 + 6:01

  const ajani = m.rows.find((r) => r.name === "Ajani Laster")!;
  expect(ajani).toMatchObject({ level: "jv", place: 20, letter: false });

  // Segment times add up to the finish for every finisher.
  for (const r of m.rows.filter((r) => r.status === "finished")) {
    expect(r.finishMs).not.toBeNull();
  }
  const dnfs = m.rows.filter((r) => r.status === "dnf");
  expect(dnfs.map((r) => [r.gender, Object.keys(r.splits).length, r.finishMs, r.place])).toEqual([
    ["M", 1, null, null], // 10:31 then DNF
    ["F", 2, null, null], // Mikayla: two splits then DNF
  ]);
  expect(m.rows.filter((r) => r.gender === "F")).toHaveLength(7);
  expect(m.rows.some((r) => r.name === "Emma Winter")).toBe(false); // blank row
});

const sheet = (rows: string[]) => ["Sample Invite, September 10th 2025", "Boys \tMile 1 \tMile 2 \tMile 3.1 \tFinish \tPlace \tLetter", ...rows].join("\n");

test("tabbed lines that aren't rows are not athletes; DNS is DNS; a placeless DNF takes the level they ran elsewhere", () => {
  const meets = parseSplitsHistory(
    sheet([
      "Eddy Giebler \t5:46 \t5:48 \t6:21 \t17:55 \t6th \tYes",
      "Girls Varsity - 108 Pts.\t4th Place. 8 Teams.",
      "Printed\t10/12/2026",
      "Will Leibham \tDNS \tDNS \tDNS \tDNS",
      "Owen Puetz \t10:31 \tDNF \tDNF \tDNF",
      "Owen Puetz \t6:30 \t7:00 \t7:30 \t21:00 \t12th JV",
    ]),
  );
  const rows = meets[0].rows;
  expect(rows.map((r) => r.name)).toEqual(["Eddy Giebler", "Will Leibham", "Owen Puetz", "Owen Puetz"]);
  expect(meets[0].summaries).toContain("Girls Varsity - 108 Pts.\t4th Place. 8 Teams.");
  expect(rows[1]).toMatchObject({ status: "dns", finishMs: null, place: null });
  expect(rows[2]).toMatchObject({ status: "dnf", level: "jv", splits: { "Mile 1": 10 * 60_000 + 31_000 } }); // level from his other row
});

test("segments that don't add up to the finish are dropped rather than written wrong; a cumulative sheet is read as such", () => {
  const meets = parseSplitsHistory(
    sheet([
      "Avery Abbott \t5:46 \t6:47 \t18:51 \t16th \tYes", // a collapsed empty Mile 2 cell
      "Blake Barlow \t5:46 \t12:04 \t18:51 \t18:51 \t17th", // printed cumulative
      "Casey Calder \t5:46 \t6:18 \t6:47 \t18:51 \t18th", // segments
    ]),
  );
  const [a, b, c] = meets[0].rows;
  expect(a).toMatchObject({ finishMs: 18 * 60_000 + 51_000, place: 16, status: "finished", splitsUnreadable: true, splits: {} });
  expect(b.splits).toEqual({ "Mile 1": 5 * 60_000 + 46_000, "Mile 2": 12 * 60_000 + 4_000 });
  expect(b.splitsUnreadable).toBe(false);
  expect(c.splits).toEqual({ "Mile 1": 5 * 60_000 + 46_000, "Mile 2": 12 * 60_000 + 4_000 });
});

test("a row that stops early with no place is a DNF with its splits, not a finish at its last time", () => {
  const meets = parseSplitsHistory(
    sheet([
      "Ajani Laster \t7:28", // only a Mile 1
      "Isaac Hasler \t7:33 \t7:34", // two splits, nothing more
      "Avery Abbott \t5:46 \t6:47 \t18:51 \t16th", // a missing cell, but a place: still a finish
    ]),
  );
  const [a, b, c] = meets[0].rows;
  expect(a).toMatchObject({ status: "dnf", finishMs: null, place: null, splits: { "Mile 1": 7 * 60_000 + 28_000 } });
  expect(b).toMatchObject({ status: "dnf", finishMs: null, splits: { "Mile 1": 7 * 60_000 + 33_000, "Mile 2": 15 * 60_000 + 7_000 } });
  expect(c).toMatchObject({ status: "finished", finishMs: 18 * 60_000 + 51_000, place: 16 });
});

test("a 'Mile 3' last column is a 5K", () => {
  const meets = parseSplitsHistory(["Sample Invite, September 10th 2025", "Boys \tMile 1 \tMile 2 \tMile 3 \tFinish \tPlace", "Eddy Giebler \t5:46 \t5:48 \t6:21 \t17:55 \t6th"].join("\n"));
  expect(meets[0].distanceMeters).toBe(5000);
});

test("this season's MEET SPLITS sheets read like the older ones: levels from the sections, letters, DNFs, no DNRs", () => {
  const sheet = readFileSync(`${process.cwd()}/src/lib/results/fixtures/meet-splits-2026.txt`, "utf8");
  const meets = parseSplitsHistory(sheet);
  expect(meets).toHaveLength(1);
  const m = meets[0];
  expect(m).toMatchObject({ name: "Lakeside Invitational", date: "2026-09-05", distanceMeters: 5000 });
  expect(m.checkpoints.map((c) => c.label)).toEqual(["Mile 1", "Mile 2"]);
  expect(m.summaries).toEqual([
    "Boys Varsity - 61 Pts. 3rd Place. 9 Teams. 60 Runners. Letter standard 40th · 22:07.",
    "Boys JV - 88 Pts. 4th Place. 6 Teams. 52 Runners.",
    "Girls Varsity - 100 Pts. 3rd Place. 7 Teams. 51 Runners.",
  ]);
  expect(m.rows.map((r) => r.name)).toEqual(["Avery Abbott", "Blake Barlow", "Casey Cole", "Drew Dalton", "Ellis Evans", "Gray Garner", "Harper Hale"]);
  expect(m.rows.find((r) => r.name === "Avery Abbott")).toMatchObject({ gender: "M", level: "varsity", finishMs: 17 * 60_000 + 31_000, place: 1, letter: true, status: "finished" });
  expect(m.rows.find((r) => r.name === "Avery Abbott")!.splits).toEqual({ "Mile 1": 5 * 60_000 + 19_000, "Mile 2": 11 * 60_000 });
  expect(m.rows.find((r) => r.name === "Drew Dalton")).toMatchObject({ level: "jv", place: 3, letter: true });
  expect(m.rows.find((r) => r.name === "Ellis Evans")).toMatchObject({ level: "jv", place: 47, letter: false });
  expect(m.rows.find((r) => r.name === "Casey Cole")).toMatchObject({ status: "dnf", finishMs: null, splits: {} });
  expect(m.rows.find((r) => r.name === "Harper Hale")).toMatchObject({ gender: "F", level: "jv" });
});

test("earlier 2026 MEET SPLITS sheets: weather after the date, gender and level on one line, marks after names, names-only did-not-run", () => {
  const sheet = readFileSync(`${process.cwd()}/src/lib/results/fixtures/meet-splits-2026-early.txt`, "utf8");
  const meets = parseSplitsHistory(sheet);
  expect(meets).toHaveLength(1);
  const m = meets[0];
  expect(m).toMatchObject({ name: "Riverside Challenge", date: "2026-09-15", distanceMeters: 5000 });
  expect(m.rows.map((r) => r.name)).toEqual(["Avery Abbott", "Blake Barlow", "Drew Dalton", "Ellis Evans"]);
  expect(m.rows.find((r) => r.name === "Avery Abbott")).toMatchObject({ level: "varsity", finishMs: 16 * 60_000 + 52_000, place: 1, letter: true });
  expect(m.rows.find((r) => r.name === "Avery Abbott")!.splits).toEqual({ "Mile 1": 5 * 60_000 + 2_000, "Mile 2": 10 * 60_000 + 43_000 });
  expect(m.rows.find((r) => r.name === "Drew Dalton")).toMatchObject({ level: "jv", place: 3, letter: true });
  expect(m.rows.find((r) => r.name === "Ellis Evans")).toMatchObject({ level: "jv", place: 52, letter: false });
  expect(m.summaries[0]).toBe("Boys Varsity - 89 Pts. 5th Place. 17 Teams. 143 Runners. Letter standard 94th · 22:03.");
});

test("newest MEET SPLITS sheets: a PR / SB badge after the finish and a letter-spaced LETTER pill", () => {
  const meets = parseSplitsHistory(
    [
      "MEET SPLITS",
      "Sample Invite • October 17, 2026 • 52°, sunny, southwest wind 12 mph, 44% humidity",
      "BOYS VARSITY",
      "AT H L E T E \tM I L E 1 \tM I L E 2 \tM I L E 3 . 1 \tF I N I S H \tP L A C E \tL E T T E R",
      "Avery Abbott \t5:10 \t5:14 \t5:42 \t16:06 PR \t2nd \tL E T T E R",
      "Blake Barlow \t5:20 \t5:30 \t5:50 \t16:40 SB \t9th \tL E T T E R",
      "Casey Cole \t5:40 \t6:11 \t6:42 \t18:33 \t34th",
    ].join("\n"),
  );
  expect(meets[0].rows.map((r) => [r.name, r.finishMs, r.place, r.letter, r.splitsUnreadable])).toEqual([
    ["Avery Abbott", 16 * 60_000 + 6_000, 2, true, false],
    ["Blake Barlow", 16 * 60_000 + 40_000, 9, true, false],
    ["Casey Cole", 18 * 60_000 + 33_000, 34, false, false],
  ]);
});

test("a race's numbers from its summary line, in either sheet format", () => {
  const old = ["Boys Varsity 92 Pts. 4th Place. 9 Teams. 70 Total Runners. Letter Pts. 47th - 21:00", "Boys JV 65 Pts. 2nd Place. 8 Teams. 93 Total Runners."];
  expect(sheetSummaryFor(old, "Boys Varsity")).toEqual({ points: 92, place: 4, teams: 9, runners: 70, letter: { place: 47, ms: 21 * 60_000 } });
  expect(sheetSummaryFor(old, "Boys JV")).toEqual({ points: 65, place: 2, teams: 8, runners: 93, letter: null });
  const now = ["Girls Varsity - 123 Pts. 5th Place. 9 Teams. 73 Runners. Letter standard 48th · 23:46."];
  expect(sheetSummaryFor(now, "Girls Varsity")).toEqual({ points: 123, place: 5, teams: 9, runners: 73, letter: { place: 48, ms: 23 * 60_000 + 46_000 } });
  expect(sheetSummaryFor(now, "Girls JV")).toBeNull();
  expect(sheetSummaryFor(now, "Boys Varsity")).toBeNull();
});
