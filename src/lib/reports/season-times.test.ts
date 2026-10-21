import { expect, test } from "vitest";
import type { HistoryRow } from "./history";
import { buildSeasonTimes, shortMeetName } from "./season-times";

test("short meet names: generic words drop, three or more words become initials", () => {
  expect(shortMeetName("Kettle Moraine Lutheran Invite")).toBe("KML");
  expect(shortMeetName("Big East Conference Championship")).toBe("Big East");
  expect(shortMeetName("WIAA Division 3 Sectional")).toBe("Sectional");
  expect(shortMeetName("Nightfall Classic")).toBe("Nightfall");
  expect(shortMeetName("55th Annual Russ Fameree Cross Country Classic")).toBe("Russ");
  expect(shortMeetName("KML Charger Cross Country Classic")).toBe("KML");
  expect(shortMeetName("Crusader Challenge")).toBe("Crusader");
  expect(shortMeetName("Sheboygan County Meet")).toBe("Sheboygan");
  expect(shortMeetName("Invitational")).toBe("Invitational");
});

const row = (athleteId: string, meetId: string, ms: number, extra: Partial<HistoryRow> = {}): HistoryRow => ({
  athleteId,
  meetId,
  meetName: meetId,
  meetShort: meetId,
  date: "2026-09-01",
  seasonId: "s",
  courseId: null,
  series: meetId,
  raceId: `${meetId}-${athleteId}`,
  raceName: "Boys Varsity",
  levelId: "varsity",
  distanceId: "5k",
  status: "finished",
  finishMs: ms,
  precision: "tenths",
  place: 1,
  grade: null,
  fieldSize: null,
  splits: [],
  counts: true,
  ...extra,
});

test("season grid: meets in date order, best marked, future meets, fastest first, no-shows last", () => {
  const { columns, byGender } = buildSeasonTimes({
    meets: [
      { id: "m2", name: "Smiley Invite", date: "2026-09-19" },
      { id: "m1", name: "Kettle Moraine Lutheran Invite", date: "2026-08-28" },
      { id: "m3", name: "WIAA Division 3 Sectional", date: "2026-10-24" },
    ],
    athletes: [
      { id: "a", name: "Avery Abbott", gender: "M", grade: 11 },
      { id: "b", name: "Blake Barlow", gender: "M", grade: 10 },
      { id: "c", name: "Casey Cole", gender: "M", grade: 9 },
    ],
    rows: [row("a", "m1", 1_100_000), row("a", "m2", 1_080_000), row("b", "m1", 1_050_000, { levelId: "jv" }), row("b", "m2", 1_000_000, { distanceId: "4k" })],
    distanceId: "5k",
    today: "2026-10-20",
  });
  expect(columns.map((c) => [c.label, c.future, c.latest])).toEqual([
    ["KML", false, false],
    ["Smiley", false, true],
    ["Sectional", true, false],
  ]);
  const boys = byGender.M;
  expect(boys.map((r) => r.athlete.id)).toEqual(["b", "a", "c"]);
  expect(boys[0].cells).toEqual([{ ms: 1_050_000, jv: true, best: true, letter: false }, null, null]); // the 4K doesn't show in a 5K grid
  expect(boys[1].cells.map((c) => c?.best ?? null)).toEqual([false, true, null]);
  expect(boys[2]).toMatchObject({ bestMs: null, races: 0 });
});

test("season grid: every time equal to the season best to the second is bold; letter at or under that meet's standard", () => {
  const { byGender } = buildSeasonTimes({
    meets: [
      { id: "m1", name: "KML", date: "2026-08-28" },
      { id: "m2", name: "Smiley", date: "2026-09-19" },
    ],
    athletes: [{ id: "a", name: "Avery Abbott", gender: "M", grade: 11 }],
    rows: [row("a", "m1", 1_080_400), row("a", "m2", 1_080_900)], // 18:00.4 and 18:00.9: both 18:00
    distanceId: "5k",
    today: "2026-10-20",
    letterMs: { m1: { M: 1_080_000 }, m2: { M: 1_079_000 } },
  });
  expect(byGender.M[0].cells.map((c) => [c?.best, c?.letter])).toEqual([
    [true, true],
    [true, false],
  ]);
});
