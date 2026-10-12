import { describe, expect, it } from "vitest";
import type { RepSet } from "@/lib/db/schema";
import { addRepAtEnd, dropLastRep } from "./workout-plan";

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
