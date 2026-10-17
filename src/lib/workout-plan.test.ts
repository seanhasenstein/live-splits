import { describe, expect, it } from "vitest";
import type { RepSet } from "@/lib/db/schema";
import { addRepAtEnd, conditionsText, describePlan, describeRest, dropLastRep, expandSets, surfaceOf, surfaceText, toSetInputs } from "./workout-plan";

const m = (meters: number) => ({ value: meters, unit: "m" as const, meters });
const sets: RepSet[] = [
  { id: "s1", reps: [1, 2].map((n) => ({ id: `s1-r${n}`, distance: m(400), rest: { kind: "time" as const, ms: 60_000 } })), restAfter: { kind: "time", ms: 120_000 } },
  { id: "s2", reps: [{ id: "s2-r1", distance: m(200), rest: { kind: "time", ms: 45_000 } }], restAfter: null },
];

describe("changing reps mid-workout", () => {
  it("adds one like the last, with a fresh id in the set's pattern", () => {
    const more = addRepAtEnd(sets);
    expect(more[1].reps.map((r) => r.id)).toEqual(["s2-r1", "s2-r2"]);
    expect(more[1].reps[1]).toMatchObject({ distance: m(200), rest: { kind: "time", ms: 45_000 } });
    expect(more[0]).toBe(sets[0]);
  });

  it("drops the last rep, and a set it empties, leaving no rest after the new last set", () => {
    const fewer = dropLastRep(sets)!;
    expect(fewer).toHaveLength(1);
    expect(fewer[0].reps).toHaveLength(2);
    expect(fewer[0].restAfter).toBeNull();
    expect(dropLastRep([{ id: "x", reps: [sets[1].reps[0]], restAfter: null }])).toBeNull();
  });
});

describe("plan round trips and labels", () => {
  it("expanding the form's sets and reading them back keeps set ids, so rep ids (and the log) survive an edit", () => {
    let n = 0;
    const once = expandSets([{ count: 3, value: 400, unit: "m", rest: { kind: "time", ms: 60_000 }, restAfter: { kind: "time", ms: 120_000 } }, { count: 2, value: 200, unit: "m", rest: { kind: "interval", everyMs: 90_000 }, restAfter: null }], () => `s${++n}`);
    expect(once.map((s) => s.reps.map((r) => r.id))).toEqual([["s1-r1", "s1-r2", "s1-r3"], ["s2-r1", "s2-r2"]]);
    expect(once[1].restAfter).toBeNull();
    const again = expandSets(toSetInputs(once), () => "new");
    expect(again.map((s) => s.reps.map((r) => r.id))).toEqual(once.map((s) => s.reps.map((r) => r.id)));
  });

  it("describes plans and rests the way coaches say them", () => {
    expect(describePlan(sets)).toBe("2 × 400m, 200m");
    expect(describeRest({ kind: "time", ms: 45_000 })).toBe("45 s rest");
    expect(describeRest({ kind: "time", ms: 150_000 })).toBe("2:30 rest");
    expect(describeRest({ kind: "interval", everyMs: 180_000 })).toBe("on the 3 min");
    expect(describeRest({ kind: "jog", meters: 200 })).toBe("200m jog");
    expect(describeRest({ kind: "open" })).toBe("rest until go");
  });

  it("add, drop, add again reuses the free id without colliding", () => {
    const dropped = dropLastRep(addRepAtEnd(sets))!;
    expect(addRepAtEnd(dropped)[1].reps.map((r) => r.id)).toEqual(["s2-r1", "s2-r2"]);
  });
});

describe("surface and conditions", () => {
  it("older workouts read their surface from the grass flag; tags read in a fixed order", () => {
    expect(surfaceOf({ surface: null, approximateDistances: true })).toBe("grass");
    expect(surfaceOf({ surface: null, approximateDistances: false })).toBe("track");
    expect(surfaceOf({ surface: "trail", approximateDistances: true })).toBe("trail");
    expect(surfaceText("track")).toBe("on the track");
    expect(conditionsText(["windy", "hot"])).toBe("hot, windy");
  });
});
