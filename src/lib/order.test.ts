import { describe, expect, it } from "vitest";
import { orderAthletes, orderKey, parseOrderMode } from "./order";
import type { LineupHistory } from "./results/history";

const names = { a: "Zoe Adams", b: "Amy Baker", c: "Mia Cole", d: "Bea Dunn" };
const lineup = ["a", "b", "c", "d"];
const history: LineupHistory = {
  races: [
    { id: "r2", label: "Meet 2 · Girls", date: "2026-09-20", courseId: null, sameCourse: false },
    { id: "r1", label: "Meet 1 · Girls", date: "2026-09-10", courseId: null, sameCourse: false },
  ],
  byAthlete: {
    a: [
      { raceId: "r2", finishMs: 1_300_000, status: "finished", splits: {}, prSb: true },
      { raceId: "r1", finishMs: 1_200_000, status: "finished", splits: {}, prSb: true },
    ],
    b: [
      { raceId: "r2", finishMs: null, status: "dnf", splits: {}, prSb: false },
      { raceId: "r1", finishMs: 1_250_000, status: "finished", splits: {}, prSb: true },
    ],
    c: [{ raceId: "r1", finishMs: 1_100_000, status: "finished", splits: {}, prSb: false }],
    // d has never raced
  },
};
const ctx = (prev: Record<string, number> = {}) => ({ lineup, names, history, prevTime: (id: string) => prev[id] ?? null });

describe("orderAthletes", () => {
  it("keeps the coach's order and sorts A–Z by display name", () => {
    expect(orderAthletes({ kind: "coach" }, ctx())).toEqual(["a", "b", "c", "d"]);
    expect(orderAthletes({ kind: "az" }, ctx())).toEqual(["b", "d", "c", "a"]);
  });

  it("orders by the previous checkpoint, unseen runners last A–Z", () => {
    expect(orderAthletes({ kind: "prev" }, ctx({ c: 500, a: 400 }))).toEqual(["a", "c", "b", "d"]);
  });

  it("last race uses each runner's most recent finish, skipping a DNF", () => {
    // a: 1300 (r2); b: 1250 (r1, since r2 was a DNF); c: 1100 (r1); d: nothing
    expect(orderAthletes({ kind: "last" }, ctx())).toEqual(["c", "b", "a", "d"]);
  });

  it("season best ignores results excluded from PR/SB", () => {
    // a: 1200; b: 1250; c excluded → no data; d none → both last, A–Z (Bea before Mia)
    expect(orderAthletes({ kind: "best" }, ctx())).toEqual(["a", "b", "d", "c"]);
  });

  it("a specific race orders by that race only", () => {
    expect(orderAthletes({ kind: "race", raceId: "r2" }, ctx())).toEqual(["a", "b", "d", "c"]);
    expect(orderAthletes({ kind: "race", raceId: "r1" }, ctx())).toEqual(["c", "a", "b", "d"]);
  });

  it("round-trips through the stored key", () => {
    for (const m of [{ kind: "prev" }, { kind: "az" }, { kind: "race", raceId: "r1" }] as const) {
      expect(parseOrderMode(orderKey(m))).toEqual(m);
    }
    expect(parseOrderMode("nonsense")).toBeNull();
    expect(parseOrderMode(null)).toBeNull();
  });
});
