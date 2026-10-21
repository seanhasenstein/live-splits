import { expect, test } from "vitest";
import { officialSegments, type ResultEntry, scoreRace, splitLabels, topFive } from "./race-results";

const e = (place: number, team: string | null, ours = false, status = "finished"): ResultEntry => ({ name: `R${place}`, team, place: status === "finished" ? place : null, status, timeMs: 1_000_000 + place * 1000, ours });

test("scoring: five score, 6th and 7th displace, 8th and incomplete teams and unattached take no place", () => {
  const entries: ResultEntry[] = [
    e(1, "A"),
    e(2, "Sheboygan Area Lutheran", true),
    e(3, "A"),
    e(4, "Small"), // only two finishers: takes no place
    e(5, null), // unattached: takes no place
    e(6, "Sheboygan Area Lutheran", true),
    e(7, "A"),
    e(8, "Sheboygan Area Lutheran", true),
    e(9, "A"),
    e(10, "Sheboygan Area Lutheran", true),
    e(11, "A"),
    e(12, "Sheboygan Area Lutheran", true),
    e(13, "A"), // A's 6th
    e(14, "Small"),
    e(15, "Sheboygan Area Lutheran", true), // our 6th
    e(16, "A"), // A's 7th
    e(17, "A"), // A's 8th: no place
    e(18, "Sheboygan Area Lutheran", true), // our 7th
    e(19, "Sheboygan Area Lutheran", true, "dnf"),
  ];
  const { teams, incomplete, points } = scoreRace(entries);
  // Scoring places: A 1,3,5,7,9 (6th 11, 7th 13); us 2,4,6,8,10 (6th 12, 7th 14).
  expect(teams.map((t) => [t.name, t.place, t.points, t.places])).toEqual([
    ["A", 1, 25, [1, 3, 5, 7, 9, 11, 13]],
    ["Sheboygan Area Lutheran", 2, 30, [2, 4, 6, 8, 10, 12, 14]],
  ]);
  expect(teams[1].ours).toBe(true);
  expect(incomplete).toEqual(["Small"]);
  expect(points.map((p) => (p ? `${p.points}${p.displacer ? "d" : ""}` : "—"))).toEqual(["1", "2", "3", "—", "—", "4", "5", "6", "7", "8", "9", "10", "11d", "—", "12d", "13d", "—", "14d", "—"]);
});

test("a tie in points goes to the team whose 6th runner placed better", () => {
  // Both 29: us 1,2,4,10,12 (6th: 13) · them 3,5,6,7,8 (6th: 9).
  const ours = [1, 2, 4, 10, 12, 13, 14];
  const entries = Array.from({ length: 14 }, (_, i) => e(i + 1, ours.includes(i + 1) ? "Us" : "Them", ours.includes(i + 1)));
  const { teams } = scoreRace(entries);
  expect(teams.map((t) => [t.name, t.points, t.place])).toEqual([
    ["Them", 29, 1],
    ["Us", 29, 2],
  ]);
});

test("top five: average and 1–5 spread", () => {
  expect(topFive([966_000, 1_009_000, 1_061_000, 1_076_000, 1_084_000, 1_093_000])).toEqual({ average: 1_039_200, spread: 118_000 });
  expect(topFive([1, 2, 3, 4])).toBeNull();
});

test("official splits: each stretch on its own from whole-second clock times, missing or out-of-order splits blank", () => {
  const labels = splitLabels([{ splits: [] }, { splits: [{ label: "2 Mile", cumulativeMs: 650_000 }, { label: "1 Mile", cumulativeMs: 320_400 }] }]);
  expect(labels).toEqual(["1 Mile", "2 Mile"]);
  expect(officialSegments([{ label: "1 Mile", cumulativeMs: 320_900 }, { label: "2 Mile", cumulativeMs: 650_200 }], labels, 1_011_800)).toEqual([320_000, 330_000, 361_000]);
  expect(officialSegments([{ label: "2 Mile", cumulativeMs: 650_200 }], labels, 1_011_800)).toEqual([null, null, 361_000]);
  expect(officialSegments([], labels, null)).toEqual([null, null, null]);
});
