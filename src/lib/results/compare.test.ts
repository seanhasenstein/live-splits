import { expect, test } from "vitest";
import { replay, type TapLike } from "../replay";
import { compareRace } from "./compare";

const race = {
  gunTimeMs: 1_000_000,
  lineup: [{ athleteId: "A", levelId: "v" }, { athleteId: "B", levelId: "v" }],
  checkpoints: [
    { id: "m1", label: "Mile 1", distance: { value: 1, unit: "mi", meters: 1609.344 }, kind: "split" },
    { id: "fin", label: "Finish", distance: { value: 5, unit: "km", meters: 5000 }, kind: "finish" },
  ],
} as const;

const tap = (id: string, p: Partial<TapLike> & { type: TapLike["type"] }): TapLike => ({
  clientTapId: id, checkpointId: "m1", athleteId: null, targetTapId: null, serverTimeMs: 0, timeMs: null, estimate: false, missed: false, ...p,
});

test("app vs official: errors, mean, max, bias", () => {
  const taps = [
    tap("1", { type: "name_tap", athleteId: "A", serverTimeMs: 1_000_000 + 300_000 + 800 }), // app 5:00.8 vs official 5:00.0 → +0.8s
    tap("2", { type: "name_tap", athleteId: "B", serverTimeMs: 1_000_000 + 320_000 - 1_200 }), // app 5:18.8 vs 5:20.0 → −1.2s
    tap("3", { type: "name_tap", athleteId: "A", checkpointId: "fin", serverTimeMs: 1_000_000 + 1_000_000 + 2_000 }), // +2.0s
  ];
  const official = {
    A: { finishMs: 1_000_000, status: "finished", place: 1, byCheckpoint: { m1: 300_000 } },
    B: { finishMs: null, status: "dnf", place: null, byCheckpoint: { m1: 320_000 } },
  };
  const { rows, summary } = compareRace(race, replay(race, taps), official);
  expect(rows[0].cells[0]).toMatchObject({ appMs: 300_800, officialMs: 300_000, errorMs: 800 });
  expect(rows[1].cells[0].errorMs).toBe(-1_200);
  expect(rows[1].cells[1]).toMatchObject({ appMs: null, officialMs: null, errorMs: null });
  expect(summary[0]).toMatchObject({ n: 2, meanAbsMs: 1_000, maxAbsMs: 1_200, meanMs: -200 });
  expect(summary[1]).toMatchObject({ n: 1, meanAbsMs: 2_000, maxAbsMs: 2_000, meanMs: 2_000 });
});

test("without a gun there are no app times to compare", () => {
  const { summary } = compareRace({ ...race, gunTimeMs: null }, replay(race, []), {});
  expect(summary.every((s) => s.n === 0)).toBe(true);
});
