import { describe, expect, it } from "vitest";
import type { Workout, WorkoutEvent } from "@/lib/db/schema";
import { buildWorkoutCsvRows } from "./workout-export";
import { replayWorkout } from "./workout-replay";

const m = (meters: number) => ({ value: meters, unit: "m" as const, meters });
const workout = {
  name: "3 × 400m",
  date: "2026-10-12",
  place: "School grounds",
  surface: "grass" as const,
  approximateDistances: true,
  conditions: ["windy" as const],
  effort: "vo2" as const,
  sets: [{ id: "s1", reps: [1, 2, 3].map((n) => ({ id: `s1-r${n}`, distance: m(400), rest: { kind: "time" as const, ms: 60_000 } })), restAfter: null }],
  groups: [{ id: "g1", name: "Fast" }],
  athletes: [
    { athleteId: "eddy", groupId: "g1", goalPaceMsPerKm: 195_000 },
    { athleteId: "titus", groupId: "g1", goalPaceMsPerKm: 200_000 },
  ],
} satisfies Partial<Workout>;

let seq = 0;
const T0 = 1_800_000_000_000;
const ev = (type: WorkoutEvent["type"], at: number, fields: Partial<WorkoutEvent> = {}): WorkoutEvent =>
  ({ _id: `e${++seq}`, schoolId: "s", schemaVersion: 1, clientEventId: `c${seq}`, workoutId: "w", type, groupId: null, athleteId: null, repId: null, targetEventId: null, deviceTimeMs: T0 + at, clockOffsetMs: 0, serverTimeMs: T0 + at, timeMs: null, note: null, createdAt: new Date(), createdBy: { type: "user", id: "u", name: "C" } as never, ...fields }) as WorkoutEvent;

describe("workout CSV", () => {
  it("reads like the paper sheet: header, a row per runner, rests under their reps", () => {
    const state = replayWorkout(workout, [
      ev("rep_start", 0, { groupId: "g1", repId: "s1-r1" }),
      ev("finish", 76_000, { athleteId: "eddy", repId: "s1-r1" }),
      ev("finish", 82_000, { athleteId: "titus", repId: "s1-r1" }),
      ev("rep_start", 145_000, { groupId: "g1", repId: "s1-r2" }),
      ev("finish", 222_000, { athleteId: "eddy", repId: "s1-r2" }),
      ev("skip", 146_000, { athleteId: "titus", repId: "s1-r2" }),
    ]);
    const rows = buildWorkoutCsvRows({ workout, state, names: new Map([["eddy", "Eddy Giebler"], ["titus", "Titus Gottschalk"]]), precision: "seconds" });
    expect(rows[0]).toEqual(["3 × 400m"]);
    expect(rows[1][0]).toBe("Monday, Oct 12, 2026 · School grounds · on grass · windy · VO₂ / intervals");
    expect(rows[2][0]).toBe("3 × 400m · 1 min rest · 1,200m total");
    const header = rows.find((r) => r[0] === "Runner")!;
    expect(header).toEqual(["Runner", "Group", "Goal", "Rep 1", "Rep 2", "Rep 3", "Avg / 400m", "vs goal", "Spread", "Fade"]);
    const eddy = rows.find((r) => r[0] === "Eddy Giebler")!;
    // Average 1:16.5 shows as 1:16 (times truncate, as everywhere in the app); vs goal −1.5 → −1; slower by 1 s on rep 2.
    expect(eddy).toEqual(["Eddy Giebler", "Fast", "1:18", "1:16", "1:17", "", "1:16", "-1", "1", "+1"]);
    const titus = rows.find((r) => r[0] === "Titus Gottschalk")!;
    expect(titus.slice(3, 6)).toEqual(["1:22", "skipped", ""]);
    // Rest after rep 1: from the last one in (82 s) to the start of rep 2 (145 s).
    expect(rows.at(-1)!.slice(0, 5)).toEqual(["Rest after", "Fast", "", "1:03", ""]);
  });
});
