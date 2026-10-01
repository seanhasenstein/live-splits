import { expect, test } from "vitest";
import { replay, type TapLike } from "./replay";

const race = { checkpoints: [{ id: "m1" }, { id: "m2" }] } as never;

/** Taps with increasing server times, all at Mile 1 unless overridden. */
function log() {
  let t = 1000;
  return (p: Partial<TapLike> & { type: TapLike["type"] }): TapLike => ({
    clientTapId: `t${t}`,
    checkpointId: "m1",
    athleteId: null,
    targetTapId: null,
    serverTimeMs: t++,
    timeMs: null,
    estimate: false,
    missed: false,
    ...p,
  });
}

const m1 = (taps: TapLike[]) => replay(race, taps).get("m1")!;

test("name tap, then replace (void + new name tap)", () => {
  const tap = log();
  const taps = [tap({ type: "name_tap", athleteId: "A" })];
  expect(m1(taps).byAthlete.get("A")!.timeMs).toBe(1000);
  taps.push(tap({ type: "void", targetTapId: "t1000" }), tap({ type: "name_tap", athleteId: "A" }));
  expect(m1(taps).byAthlete.get("A")!.timeMs).toBe(1002);
});

test("capture twice, assign the oldest, undo the assign returns the slot", () => {
  const tap = log();
  const taps = [tap({ type: "capture" }), tap({ type: "capture" })];
  expect(m1(taps).pending.map((x) => x.tapId)).toEqual(["t1000", "t1001"]);

  taps.push(tap({ type: "assign", athleteId: "B", targetTapId: "t1000" }));
  expect(m1(taps).pending.map((x) => x.tapId)).toEqual(["t1001"]);
  expect(m1(taps).byAthlete.get("B")!.timeMs).toBe(1000);

  taps.push(tap({ type: "void", targetTapId: "t1002" }));
  expect(m1(taps).pending.length).toBe(2);
  expect(m1(taps).byAthlete.has("B")).toBe(false);
});

test("swap two athletes with two edits", () => {
  const tap = log();
  const taps = [
    tap({ type: "name_tap", athleteId: "A" }),
    tap({ type: "name_tap", athleteId: "B" }),
    tap({ type: "edit", targetTapId: "t1000", athleteId: "B" }),
    tap({ type: "edit", targetTapId: "t1001", athleteId: "A" }),
  ];
  const cp = m1(taps);
  expect(cp.byAthlete.get("A")!.tapId).toBe("t1001");
  expect(cp.byAthlete.get("B")!.tapId).toBe("t1000");
  expect(cp.byAthlete.get("A")!.edited).toBe(true);
});

test("nudge a time and mark an athlete missed", () => {
  const tap = log();
  const taps = [
    tap({ type: "name_tap", athleteId: "A" }),
    tap({ type: "edit", targetTapId: "t1000", timeMs: 999 }),
    tap({ type: "edit", athleteId: "C", missed: true }),
  ];
  const cp = m1(taps);
  expect(cp.byAthlete.get("A")!.timeMs).toBe(999);
  expect(cp.byAthlete.get("A")!.edited).toBe(true);
  expect(cp.byAthlete.get("C")!.missed).toBe(true);
});

test("voiding a capture also voids the assignment made from it", () => {
  const tap = log();
  const taps = [
    tap({ type: "capture" }),
    tap({ type: "assign", athleteId: "D", targetTapId: "t1000" }),
    tap({ type: "void", targetTapId: "t1000" }),
  ];
  expect(m1(taps).byAthlete.has("D")).toBe(false);
  expect(m1(taps).pending.length).toBe(0);
});

test("events are ordered by server time, not arrival order", () => {
  const tap = log();
  const taps = [
    tap({ type: "void", targetTapId: "later", serverTimeMs: 5000 }),
    tap({ type: "name_tap", athleteId: "A", clientTapId: "later", serverTimeMs: 4000 }),
  ];
  expect(m1(taps).byAthlete.has("A")).toBe(false);
});

test("gun and taps at other checkpoints don't leak in", () => {
  const tap = log();
  const taps = [tap({ type: "gun", checkpointId: null }), tap({ type: "name_tap", athleteId: "A", checkpointId: "m2" })];
  expect(m1(taps).byAthlete.size).toBe(0);
  expect(replay(race, taps).get("m2")!.byAthlete.get("A")!.timeMs).toBe(1001);
});
