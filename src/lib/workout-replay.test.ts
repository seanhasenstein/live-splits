import { describe, expect, it } from "vitest";
import type { Workout, WorkoutEvent } from "@/lib/db/schema";
import { flattenPlan, goalPaceFrom5K, replayWorkout, summarize } from "./workout-replay";

const m = (meters: number) => ({ value: meters, unit: "m" as const, meters });
// 3 × 400 with 60 s rest, then 2 min, then 2 × 200 on the 90 s.
const workout: Pick<Workout, "sets" | "groups" | "athletes"> = {
  sets: [
    { id: "s1", reps: [1, 2, 3].map((n) => ({ id: `a${n}`, distance: m(400), rest: { kind: "time" as const, ms: 60_000 } })), restAfter: { kind: "time", ms: 120_000 } },
    { id: "s2", reps: [1, 2].map((n) => ({ id: `b${n}`, distance: m(200), rest: { kind: "interval" as const, everyMs: 90_000 } })), restAfter: null },
  ],
  groups: [
    { id: "g1", name: "Group 1" },
    { id: "g2", name: "Group 2" },
  ],
  athletes: [
    { athleteId: "eddy", groupId: "g1", goalPaceMsPerKm: 195_000 }, // 78 s per 400
    { athleteId: "titus", groupId: "g1", goalPaceMsPerKm: 200_000 }, // 80 s
    { athleteId: "will", groupId: "g2", goalPaceMsPerKm: 210_000 },
  ],
};

let seq = 0;
const T0 = 1_800_000_000_000;
const ev = (type: WorkoutEvent["type"], at: number, fields: Partial<WorkoutEvent> = {}): WorkoutEvent => ({
  _id: `e${++seq}`,
  schoolId: "s",
  schemaVersion: 1,
  clientEventId: fields.clientEventId ?? `c${seq}`,
  workoutId: "w",
  type,
  groupId: null,
  athleteId: null,
  repId: null,
  targetEventId: null,
  deviceTimeMs: T0 + at,
  clockOffsetMs: 0,
  serverTimeMs: T0 + at,
  timeMs: null,
  note: null,
  createdAt: new Date(),
  createdBy: { type: "user", id: "u", name: "Coach" } as never,
  ...fields,
});

describe("flattenPlan", () => {
  it("numbers reps within sets and gives each the rest that follows it", () => {
    const reps = flattenPlan(workout);
    expect(reps.map((r) => [r.id, r.setIndex, r.number, r.setSize, r.label])).toEqual([
      ["a1", 0, 1, 3, "400m"],
      ["a2", 0, 2, 3, "400m"],
      ["a3", 0, 3, 3, "400m"],
      ["b1", 1, 1, 2, "200m"],
      ["b2", 1, 2, 2, "200m"],
    ]);
    expect(reps[0].restAfter).toEqual({ kind: "time", ms: 60_000 });
    expect(reps[2].restAfter).toEqual({ kind: "time", ms: 120_000 }); // the set's rest
    expect(reps[4].restAfter).toBeNull();
  });
});

describe("replayWorkout", () => {
  it("times each athlete's rep from their group's start and compares it to their goal", () => {
    const s = replayWorkout(workout, [ev("rep_start", 0, { groupId: "g1", repId: "a1" }), ev("finish", 76_000, { athleteId: "eddy", repId: "a1" }), ev("finish", 82_500, { athleteId: "titus", repId: "a1" })]);
    expect(s.athletes.get("eddy")![0]).toMatchObject({ status: "done", elapsedMs: 76_000, goalMs: 78_000, deltaMs: -2_000 });
    expect(s.athletes.get("titus")![0]).toMatchObject({ elapsedMs: 82_500, deltaMs: 2_500 });
    expect(s.athletes.get("will")![0].status).toBe("pending"); // group 2 hasn't started
    // Everyone in group 1 is in: resting 60 s from the last finisher.
    expect(s.groups.get("g1")).toMatchObject({ kind: "rest", afterRepIndex: 0, restStartedMs: T0 + 82_500, nextStartMs: T0 + 142_500, rest: { kind: "time", ms: 60_000 }, stillOut: 0 });
    expect(s.groups.get("g2")).toEqual({ kind: "before", nextRepIndex: 0 });
  });

  it("a group is running until everyone is in; on-the-clock rest counts from the rep's start", () => {
    const base = [ev("rep_start", 0, { groupId: "g1", repId: "b1" }), ev("finish", 35_000, { athleteId: "eddy", repId: "b1" })];
    expect(replayWorkout(workout, base).groups.get("g1")).toMatchObject({ kind: "running", repIndex: 3, startMs: T0 });
    const s = replayWorkout(workout, [...base, ev("finish", 38_000, { athleteId: "titus", repId: "b1" })]);
    expect(s.groups.get("g1")).toMatchObject({ kind: "rest", nextStartMs: T0 + 90_000 });
  });

  it("skips, stops, rejoins, late arrivals and group moves", () => {
    const s = replayWorkout(workout, [
      ev("rep_start", 0, { groupId: "g1", repId: "a1" }),
      ev("finish", 76_000, { athleteId: "eddy", repId: "a1" }),
      ev("skip", 77_000, { athleteId: "titus", repId: "a1" }),
      ev("stop", 78_000, { athleteId: "titus", repId: "a2" }),
      ev("rejoin", 300_000, { athleteId: "titus", repId: "b1" }),
      ev("move", 79_000, { athleteId: "sam", groupId: "g1", repId: "a2" }), // arrived late
      ev("move", 80_000, { athleteId: "will", groupId: "g1", repId: "a3" }), // moved up
    ]);
    expect(s.athletes.get("titus")!.map((r) => r.status)).toEqual(["skipped", "stopped", "stopped", "pending", "pending"]);
    expect(s.athletes.get("sam")!.map((r) => r.status)).toEqual(["stopped", "pending", "pending", "pending", "pending"]);
    expect(s.athletes.get("sam")![1].goalMs).toBeNull(); // no goal set for a walk-on
    expect(s.athletes.get("will")!.map((r) => r.groupId)).toEqual(["g2", "g2", "g1", "g1", "g1"]);
    // Titus skipped and Eddy finished: group 1 is resting after rep 1.
    expect(s.groups.get("g1")).toMatchObject({ kind: "rest", afterRepIndex: 0 });
  });

  it("a staggered start times that athlete from their own start; a finish beats a skip", () => {
    const s = replayWorkout(workout, [
      ev("rep_start", 0, { groupId: "g1", repId: "a1" }),
      ev("rep_start", 10_000, { athleteId: "titus", repId: "a1" }),
      ev("skip", 5_000, { groupId: "g1", repId: "a1" }),
      ev("finish", 90_000, { athleteId: "titus", repId: "a1" }),
    ]);
    expect(s.athletes.get("titus")![0]).toMatchObject({ status: "done", elapsedMs: 80_000 });
    expect(s.athletes.get("eddy")![0].status).toBe("skipped");
  });

  it("void removes a finish whenever it arrives; edits move the time, latest wins", () => {
    const fin = ev("finish", 76_000, { athleteId: "eddy", repId: "a1", clientEventId: "fin" });
    const start = ev("rep_start", 0, { groupId: "g1", repId: "a1", clientEventId: "start" });
    expect(replayWorkout(workout, [ev("void", 1, { targetEventId: "fin" }), start, fin]).athletes.get("eddy")![0].status).toBe("running");
    const s = replayWorkout(workout, [
      start,
      fin,
      ev("edit", 100_000, { targetEventId: "fin", timeMs: T0 + 77_000 }),
      ev("edit", 110_000, { targetEventId: "fin", timeMs: T0 + 75_500 }),
      ev("edit", 120_000, { targetEventId: "start", timeMs: T0 + 500 }),
    ]);
    expect(s.athletes.get("eddy")![0].elapsedMs).toBe(75_000);
  });

  it("the last rep, when everyone's in, is the end", () => {
    const evs = [
      ...["a1", "a2", "a3", "b1", "b2"].flatMap((id, i) => [ev("rep_start", i * 200_000, { groupId: "g1", repId: id }), ev("finish", i * 200_000 + 60_000, { athleteId: "eddy", repId: id }), ev("finish", i * 200_000 + 61_000, { athleteId: "titus", repId: id })]),
    ];
    expect(replayWorkout(workout, evs).groups.get("g1")).toEqual({ kind: "done", endedEarlyAfter: null, endEventId: null });
  });
});

describe("rests the coach controls", () => {
  it("starting the rest early puts the group at rest with runners still out; they can still be timed; a later rep leaves them with no time", () => {
    const base = [ev("rep_start", 0, { groupId: "g1", repId: "a1" }), ev("finish", 76_000, { athleteId: "eddy", repId: "a1" }), ev("rest_start", 80_000, { groupId: "g1", repId: "a1" })];
    const s = replayWorkout(workout, base);
    expect(s.groups.get("g1")).toMatchObject({ kind: "rest", afterRepIndex: 0, restStartedMs: T0 + 80_000, nextStartMs: T0 + 140_000, stillOut: 1 });
    expect(s.athletes.get("titus")![0].status).toBe("running");
    // Titus comes in during the rest: timed against the rep's start.
    const late = replayWorkout(workout, [...base, ev("finish", 95_000, { athleteId: "titus", repId: "a1" })]);
    expect(late.athletes.get("titus")![0]).toMatchObject({ status: "done", elapsedMs: 95_000 });
    // Or the next rep goes without him finishing: no time for rep 1.
    const on = replayWorkout(workout, [...base, ev("rep_start", 140_000, { groupId: "g1", repId: "a2" })]);
    expect(on.athletes.get("titus")![0].status).toBe("unfinished");
    expect(on.athletes.get("titus")![1].status).toBe("running");
    // A time typed in afterwards (from a watch) gives him rep 1 back, without touching rep 2 or the group.
    const typed = replayWorkout(workout, [...base, ev("rep_start", 140_000, { groupId: "g1", repId: "a2" }), ev("finish", 300_000, { athleteId: "titus", repId: "a1", timeMs: T0 + 84_000 })]);
    expect(typed.athletes.get("titus")![0]).toMatchObject({ status: "done", elapsedMs: 84_000 });
    expect(typed.athletes.get("titus")![1].status).toBe("running");
    expect(typed.groups.get("g1")).toMatchObject({ kind: "running", repIndex: 1 });
  });

  it("a skipped rep can be made up later on the runner's own clock", () => {
    const base = [
      ev("rep_start", 0, { groupId: "g1", repId: "a1" }),
      ev("skip", 1_000, { athleteId: "titus", repId: "a1" }),
      ev("finish", 76_000, { athleteId: "eddy", repId: "a1" }),
      ev("rep_start", 140_000, { groupId: "g1", repId: "a2" }),
    ];
    expect(replayWorkout(workout, base).athletes.get("titus")![0].status).toBe("skipped");
    const going = replayWorkout(workout, [...base, ev("rep_start", 600_000, { groupId: "g1", athleteId: "titus", repId: "a1" })]);
    expect(going.athletes.get("titus")![0]).toMatchObject({ status: "running", makeUp: true, startMs: T0 + 600_000 });
    // The group carries on with rep 2 regardless.
    expect(going.groups.get("g1")).toMatchObject({ kind: "running", repIndex: 1 });
    const done = replayWorkout(workout, [...base, ev("rep_start", 600_000, { groupId: "g1", athleteId: "titus", repId: "a1" }), ev("finish", 681_000, { athleteId: "titus", repId: "a1" })]);
    expect(done.athletes.get("titus")![0]).toMatchObject({ status: "done", makeUp: true, elapsedMs: 81_000 });
  });

  it("a runner's own late start can be undone or restarted", () => {
    const start = ev("rep_start", 5_000, { groupId: "g1", athleteId: "titus", repId: "a1", clientEventId: "late1" });
    const base = [ev("rep_start", 0, { groupId: "g1", repId: "a1" }), start];
    expect(replayWorkout(workout, base).athletes.get("titus")![0]).toMatchObject({ startMs: T0 + 5_000, ownStartEventId: "late1" });
    const undone = replayWorkout(workout, [...base, ev("void", 6_000, { targetEventId: "late1" })]);
    expect(undone.athletes.get("titus")![0]).toMatchObject({ startMs: T0, ownStartEventId: null });
    const again = replayWorkout(workout, [...base, ev("rep_start", 9_000, { groupId: "g1", athleteId: "titus", repId: "a1", clientEventId: "late2" })]);
    expect(again.athletes.get("titus")![0]).toMatchObject({ startMs: T0 + 9_000, ownStartEventId: "late2" });
  });

  it("a rest on hold has no countdown and no plan to be over; undoing the hold brings the countdown back", () => {
    const base = [
      ev("rep_start", 0, { groupId: "g1", repId: "a1" }),
      ev("finish", 76_000, { athleteId: "eddy", repId: "a1" }),
      ev("finish", 80_000, { athleteId: "titus", repId: "a1" }),
      ev("hold", 85_000, { groupId: "g1", repId: "a1", clientEventId: "h1" }),
    ];
    const held = replayWorkout(workout, base);
    expect(held.groups.get("g1")).toMatchObject({ kind: "rest", nextStartMs: null, holdEventId: "h1" });
    const after = replayWorkout(workout, [...base, ev("rep_start", 400_000, { groupId: "g1", repId: "a2" })]);
    expect(after.groupLog.get("g1")![0]).toMatchObject({ restMs: 320_000, plannedRestMs: null });
    const undone = replayWorkout(workout, [...base, ev("void", 90_000, { targetEventId: "h1" })]);
    expect(undone.groups.get("g1")).toMatchObject({ kind: "rest", nextStartMs: T0 + 140_000, holdEventId: null });
  });

  it("ending a group early: done once everyone's in, and the reps after aren't run", () => {
    const evs = [
      ev("rep_start", 0, { groupId: "g1", repId: "a1" }),
      ev("finish", 76_000, { athleteId: "eddy", repId: "a1" }),
      ev("group_end", 77_000, { groupId: "g1", repId: "a1", clientEventId: "end1" }),
    ];
    // Titus is still out: the group is still running its last rep, with no rest after it.
    expect(replayWorkout(workout, evs).groups.get("g1")).toMatchObject({ kind: "running", repIndex: 0 });
    const s = replayWorkout(workout, [...evs, ev("finish", 80_000, { athleteId: "titus", repId: "a1" })]);
    expect(s.groups.get("g1")).toEqual({ kind: "done", endedEarlyAfter: 0, endEventId: "end1" });
    expect(s.athletes.get("eddy")!.map((r) => r.status)).toEqual(["done", "not_run", "not_run", "not_run", "not_run"]);
    // Group 2 isn't affected.
    expect(s.athletes.get("will")![1].status).toBe("pending");
  });

  it("a rep added after a group finished puts it back at rest before the new rep; a group ended at the old last stays done", () => {
    const one = { ...workout, sets: [{ id: "s1", reps: [workout.sets[0].reps[0]], restAfter: null }] };
    const evs = [
      ev("rep_start", 0, { groupId: "g1", repId: "a1" }),
      ev("finish", 76_000, { athleteId: "eddy", repId: "a1" }),
      ev("finish", 80_000, { athleteId: "titus", repId: "a1" }),
      ev("rep_start", 0, { groupId: "g2", repId: "a1" }),
      ev("finish", 90_000, { athleteId: "will", repId: "a1" }),
      ev("group_end", 100_000, { groupId: "g2", repId: "a1" }),
    ];
    expect(replayWorkout(one, evs).groups.get("g1")).toMatchObject({ kind: "done" });
    const more = { ...one, sets: [{ id: "s1", reps: [workout.sets[0].reps[0], { ...workout.sets[0].reps[0], id: "a1b" }], restAfter: null }] };
    const s = replayWorkout(more, evs);
    expect(s.groups.get("g1")).toMatchObject({ kind: "rest", afterRepIndex: 0, nextStartMs: T0 + 140_000 });
    expect(s.groups.get("g2")).toMatchObject({ kind: "done", endedEarlyAfter: 0 });
  });

  it("events for a rep dropped from the plan are ignored", () => {
    const s = replayWorkout(workout, [ev("rep_start", 0, { groupId: "g1", repId: "gone" }), ev("finish", 70_000, { athleteId: "eddy", repId: "gone" })]);
    expect(s.groups.get("g1")).toMatchObject({ kind: "before" });
    expect(s.athletes.get("eddy")!.every((r) => r.status === "pending")).toBe(true);
  });

  it("logs the rest each group actually took against the plan", () => {
    const s = replayWorkout(workout, [
      ev("rep_start", 0, { groupId: "g1", repId: "a1" }),
      ev("finish", 76_000, { athleteId: "eddy", repId: "a1" }),
      ev("finish", 80_000, { athleteId: "titus", repId: "a1" }),
      ev("rep_start", 152_000, { groupId: "g1", repId: "a2" }), // 72 s of rest against 60 planned
      ev("finish", 230_000, { athleteId: "eddy", repId: "a2" }),
    ]);
    expect(s.groupLog.get("g1")).toEqual([
      { repIndex: 0, startMs: T0, restStartMs: T0 + 80_000, nextStartMs: T0 + 152_000, restMs: 72_000, plannedRestMs: 60_000 },
      { repIndex: 1, startMs: T0 + 152_000, restStartMs: null, nextStartMs: null, restMs: null, plannedRestMs: 60_000 },
    ]);
  });
});

describe("edge cases from review", () => {
  const last = ev("rep_start", 0, { groupId: "g1", repId: "b2" });
  it("starting the rest early on the last rep is ignored: it runs until everyone's in, then it's done", () => {
    const evs = [last, ev("finish", 30_000, { athleteId: "eddy", repId: "b2" }), ev("rest_start", 31_000, { groupId: "g1", repId: "b2" })];
    expect(replayWorkout(workout, evs).groups.get("g1")).toMatchObject({ kind: "running", repIndex: 4 });
    expect(replayWorkout(workout, [...evs, ev("finish", 40_000, { athleteId: "titus", repId: "b2" })]).groups.get("g1")).toMatchObject({ kind: "done" });
  });

  it("a make-up during the group's rest doesn't cancel the rest", () => {
    const evs = [
      ev("rep_start", 0, { groupId: "g1", repId: "a1" }),
      ev("skip", 1_000, { athleteId: "titus", repId: "a1" }),
      ev("finish", 76_000, { athleteId: "eddy", repId: "a1" }),
      ev("rep_start", 80_000, { groupId: "g1", athleteId: "titus", repId: "a1" }),
    ];
    expect(replayWorkout(workout, evs).groups.get("g1")).toMatchObject({ kind: "rest", afterRepIndex: 0, nextStartMs: T0 + 136_000 });
  });

  it("a skip can be undone before (or during) the rep", () => {
    const evs = [ev("skip", 0, { athleteId: "titus", repId: "a1", clientEventId: "sk1" }), ev("rep_start", 1_000, { groupId: "g1", repId: "a1" })];
    expect(replayWorkout(workout, evs).athletes.get("titus")![0]).toMatchObject({ status: "skipped", skipEventId: "sk1" });
    expect(replayWorkout(workout, [...evs, ev("void", 2_000, { targetEventId: "sk1" })]).athletes.get("titus")![0]).toMatchObject({ status: "running", skipEventId: null });
  });

  it("moving someone back counts, even when it's sent at an earlier rep than the move out", () => {
    const evs = [ev("move", 0, { athleteId: "eddy", groupId: "g2", repId: "a3" }), ev("move", 10_000, { athleteId: "eddy", groupId: "g1", repId: "a2" })];
    const s = replayWorkout(workout, evs);
    expect(s.groupAt("eddy", 2)).toBe("g1");
    expect(s.groupAt("eddy", 4)).toBe("g1");
  });

  it("a group run on individual starts still leaves a runner who never came in with no time once the next rep starts", () => {
    const evs = [
      ev("rep_start", 0, { groupId: "g1", athleteId: "eddy", repId: "a1" }),
      ev("rep_start", 0, { groupId: "g1", athleteId: "titus", repId: "a1" }),
      ev("finish", 75_000, { athleteId: "eddy", repId: "a1" }),
      ev("rep_start", 140_000, { groupId: "g1", athleteId: "eddy", repId: "a2" }),
    ];
    expect(replayWorkout(workout, evs).athletes.get("titus")![0].status).toBe("unfinished");
  });
});

describe("typed rep times", () => {
  it("a typed time needs no start or finish, beats a tap, and can be edited or undone", () => {
    const typed = ev("time", 500_000, { athleteId: "titus", repId: "a2", timeMs: 79_000, clientEventId: "ty1" });
    // Rep 2 was never started in the app: the paper time still goes in.
    const s = replayWorkout(workout, [typed]);
    expect(s.athletes.get("titus")![1]).toMatchObject({ status: "done", elapsedMs: 79_000, deltaMs: -1_000, typedEventId: "ty1" });
    // It beats a tapped finish on the same rep.
    const tapped = [ev("rep_start", 0, { groupId: "g1", repId: "a1" }), ev("finish", 85_000, { athleteId: "eddy", repId: "a1" })];
    expect(replayWorkout(workout, [...tapped, ev("time", 600_000, { athleteId: "eddy", repId: "a1", timeMs: 77_000 })]).athletes.get("eddy")![0].elapsedMs).toBe(77_000);
    // An edit changes the time itself; a void takes it back out.
    expect(replayWorkout(workout, [typed, ev("edit", 510_000, { targetEventId: "ty1", timeMs: 81_000 })]).athletes.get("titus")![1].elapsedMs).toBe(81_000);
    expect(replayWorkout(workout, [typed, ev("void", 520_000, { targetEventId: "ty1" })]).athletes.get("titus")![1].status).toBe("pending");
    // A skipped rep with a typed time ran after all.
    expect(replayWorkout(workout, [ev("skip", 0, { athleteId: "titus", repId: "a2" }), typed]).athletes.get("titus")![1].status).toBe("done");
  });
});

describe("marking runners after the fact", () => {
  it("done for today from a past rep turns a no-time into done-for-today, but keeps any real time", () => {
    const evs = [
      ev("rep_start", 0, { groupId: "g1", repId: "a1" }),
      ev("finish", 76_000, { athleteId: "eddy", repId: "a1" }),
      ev("rep_start", 140_000, { groupId: "g1", repId: "a2" }),
      ev("finish", 215_000, { athleteId: "eddy", repId: "a2" }),
      ev("finish", 218_000, { athleteId: "titus", repId: "a2" }),
    ];
    expect(replayWorkout(workout, evs).athletes.get("titus")![0].status).toBe("unfinished");
    const marked = replayWorkout(workout, [...evs, ev("stop", 900_000, { athleteId: "titus", repId: "a1" })]).athletes.get("titus")!;
    expect(marked.map((r) => r.status)).toEqual(["stopped", "done", "stopped", "stopped", "stopped"]);
  });
});

describe("rest from the first runner in", () => {
  it("starts the countdown at the first finish, with the others still out and still tappable", () => {
    const firstIn = { ...workout, sets: [{ ...workout.sets[0], reps: workout.sets[0].reps.map((r) => ({ ...r, rest: { kind: "time" as const, ms: 60_000, from: "first" as const } })) }, workout.sets[1]] };
    const evs = [ev("rep_start", 0, { groupId: "g1", repId: "a1" }), ev("finish", 70_000, { athleteId: "eddy", repId: "a1" })];
    const s = replayWorkout(firstIn, evs);
    expect(s.groups.get("g1")).toMatchObject({ kind: "rest", afterRepIndex: 0, restStartedMs: T0 + 70_000, nextStartMs: T0 + 130_000, stillOut: 1 });
    expect(s.athletes.get("titus")![0].status).toBe("running");
    // Before anyone's in, it's still the rep.
    expect(replayWorkout(firstIn, [evs[0]]).groups.get("g1")).toMatchObject({ kind: "running" });
    // The log counts the rest from the first in, against the plan.
    const after = replayWorkout(firstIn, [...evs, ev("finish", 90_000, { athleteId: "titus", repId: "a1" }), ev("rep_start", 131_000, { groupId: "g1", repId: "a2" })]);
    expect(after.groupLog.get("g1")![0]).toMatchObject({ restStartMs: T0 + 70_000, restMs: 61_000, plannedRestMs: 60_000 });
  });
});

describe("summarize", () => {
  it("average pace, average vs goal, spread and fade across reps of any distance", () => {
    const reps = flattenPlan(workout);
    const s = replayWorkout(workout, [
      ev("rep_start", 0, { groupId: "g1", repId: "a1" }),
      ev("finish", 76_000, { athleteId: "eddy", repId: "a1" }),
      ev("rep_start", 200_000, { groupId: "g1", repId: "a2" }),
      ev("finish", 278_000, { athleteId: "eddy", repId: "a2" }),
      ev("rep_start", 400_000, { groupId: "g1", repId: "b1" }),
      ev("finish", 440_000, { athleteId: "eddy", repId: "b1" }),
    ]);
    const sum = summarize(reps, s.athletes.get("eddy")!);
    expect(sum.done).toBe(3);
    expect(sum.avgPaceMsPerKm).toBe(Math.round((190_000 + 195_000 + 200_000) / 3));
    expect(sum.avgDeltaMs).toBe(Math.round((-2_000 + 0 + 1_000) / 3));
    expect(sum.spreadMsPerKm).toBe(10_000);
    expect(sum.fadeMsPerKm).toBe(10_000); // last (200 s/km) vs first (190)
  });
});

describe("goalPaceFrom5K", () => {
  it("by effort, from 5K pace", () => {
    const fiveK = 17 * 60_000; // 3:24 / km
    expect(goalPaceFrom5K(fiveK, "race")).toBe(204_000);
    expect(goalPaceFrom5K(fiveK, "vo2")).toBe(Math.round(204_000 * 0.96));
    expect(goalPaceFrom5K(fiveK, "custom")).toBeNull();
  });
});
