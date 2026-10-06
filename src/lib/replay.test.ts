import { expect, test } from "vitest";
import { expectedAt, replay, replayStatuses, type TapLike } from "./replay";

const race = { checkpoints: [{ id: "m1" }, { id: "m2" }] } as unknown as Parameters<typeof replay>[0];

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

test("an undo that sorts a few ms before its target still applies", () => {
  const tap = log();
  const taps = [
    tap({ type: "name_tap", athleteId: "A", serverTimeMs: 1000 }),
    // Clock resync lowered the offset: the void lands 'before' the tap it undoes.
    tap({ type: "void", targetTapId: "t1000", serverTimeMs: 995 }),
  ];
  expect(m1(taps).byAthlete.has("A")).toBe(false);
});

test("replace then undo puts the original time back", () => {
  const tap = log();
  const taps = [
    tap({ type: "name_tap", athleteId: "A", serverTimeMs: 5000 }), // original 5000
    tap({ type: "void", targetTapId: "t1000", serverTimeMs: 6000 }), // replace: void old…
    tap({ type: "name_tap", athleteId: "A", serverTimeMs: 6001 }), // …record new (6001)
    tap({ type: "void", targetTapId: "t1002", serverTimeMs: 7000 }), // undo: void new…
    tap({ type: "name_tap", athleteId: "A", timeMs: 5000, serverTimeMs: 7001 }), // …restore old
  ];
  expect(m1(taps).byAthlete.get("A")!.timeMs).toBe(5000);
});

test("replace a captured time, then undo: the capture goes back to the athlete, not to pending", () => {
  const tap = log();
  const taps = [
    tap({ type: "capture", serverTimeMs: 1000 }), // t1000
    tap({ type: "assign", athleteId: "X", targetTapId: "t1000", serverTimeMs: 2000 }), // t1001
    tap({ type: "void", targetTapId: "t1001", serverTimeMs: 3000 }), // replace: void the assign…
    tap({ type: "name_tap", athleteId: "X", serverTimeMs: 3001 }), // …record a new time (t1003)
    tap({ type: "void", targetTapId: "t1003", serverTimeMs: 4000 }), // undo: void the new time…
    tap({ type: "assign", athleteId: "X", targetTapId: "t1000", serverTimeMs: 4001 }), // …re-assign the capture
  ];
  const cp = m1(taps);
  expect(cp.byAthlete.get("X")!.timeMs).toBe(1000);
  expect(cp.pending).toHaveLength(0);
});

test("a pack shares one capture: the slot keeps its names and leaves pending", () => {
  const tap = log();
  const taps = [
    tap({ type: "capture" }), // t1000
    tap({ type: "assign", athleteId: "A", targetTapId: "t1000" }),
    tap({ type: "assign", athleteId: "B", targetTapId: "t1000" }),
    tap({ type: "assign", athleteId: "C", targetTapId: "t1000" }),
  ];
  const cp = m1(taps);
  expect(cp.pending).toHaveLength(0);
  expect(cp.slots).toHaveLength(1);
  expect(cp.slots[0].athleteIds.sort()).toEqual(["A", "B", "C"]);
  expect(cp.byAthlete.get("C")!.timeMs).toBe(1000);
  // Undo one of them: the slot stays, with two names.
  const cp2 = m1([...taps, tap({ type: "void", targetTapId: "t1003" })]);
  expect(cp2.slots[0].athleteIds.sort()).toEqual(["A", "B"]);
  expect(cp2.pending).toHaveLength(0);
});

test("statuses: newest wins, void clears, DNF keeps the last checkpoint passed", () => {
  const tap = log();
  const taps = [tap({ type: "status", athleteId: "A", status: "dns", checkpointId: null })];
  expect(replayStatuses(taps).get("A")?.status).toBe("dns");

  taps.push(tap({ type: "status", athleteId: "A", status: "dnf", checkpointId: "m1" }));
  const dnf = replayStatuses(taps).get("A")!;
  expect(dnf.status).toBe("dnf");
  expect(dnf.afterCheckpointId).toBe("m1");
  expect(expectedAt(dnf, 0, race.checkpoints)).toBe(true);
  expect(expectedAt(dnf, 1, race.checkpoints)).toBe(false);
  expect(expectedAt({ ...dnf, afterCheckpointId: null }, 0, race.checkpoints)).toBe(false);
  expect(expectedAt({ ...dnf, status: "dnr" }, 0, race.checkpoints)).toBe(false);
  expect(expectedAt(undefined, 1, race.checkpoints)).toBe(true);

  taps.push(tap({ type: "void", targetTapId: dnf.tapId }));
  expect(replayStatuses(taps).has("A")).toBe(false);
});
