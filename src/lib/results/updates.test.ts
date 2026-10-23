import { expect, test } from "vitest";
import { diffField, type FieldRow } from "./updates";

const r = (name: string, team: string | null, place: number | null, timeMs: number | null, status = "finished"): FieldRow => ({ name, team, place, status, timeMs });
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

test("no change: same field, tenths re-rounded, name spelled in other case", () => {
  const stored = [r("Ana Lee", "Kohler", 1, 1_000_100), r("Bo Ray", "Mishicot", 2, 1_010_000)];
  const fresh = [r("ANA LEE", "Kohler", 1, 1_000_900), r("Bo Ray", "Mishicot", 2, 1_010_000)];
  expect(diffField(stored, fresh, fmt)).toEqual([]);
});

test("a fixed time, a DQ, a runner added and one taken out", () => {
  const stored = [r("Ana Lee", "Kohler", 1, 1_000_000), r("Bo Ray", "Mishicot", 2, 1_010_000), r("Cy Fox", "Hilbert", 3, 1_020_000)];
  const fresh = [r("Ana Lee", "Kohler", 1, 1_002_000), r("Bo Ray", "Mishicot", null, null, "dq"), r("Di Moe", "Valders", 2, 1_015_000)];
  expect(diffField(stored, fresh, fmt)).toEqual([
    { kind: "changed", name: "Ana Lee", team: "Kohler", what: ["time 16:40 → 16:42"] },
    { kind: "changed", name: "Bo Ray", team: "Mishicot", what: ["FINISHED → DQ", "place 2 → —"] },
    { kind: "added", name: "Di Moe", team: "Valders", place: 2, timeMs: 1_015_000, status: "finished" },
    { kind: "removed", name: "Cy Fox", team: "Hilbert" },
  ]);
});

test("a division race compares only our division's teams, and not places (the app re-ranked them)", () => {
  const stored = [r("Ana Lee", "Kohler", 1, 1_000_000), r("Bo Ray", "Mishicot", 2, 1_010_000)];
  const fresh = [r("Zed Big", "Big School", 1, 990_000), r("Ana Lee", "Kohler", 2, 1_000_000), r("Bo Ray", "Mishicot", 3, 1_011_000)];
  expect(diffField(stored, fresh, fmt, { places: false })).toEqual([{ kind: "changed", name: "Bo Ray", team: "Mishicot", what: ["time 16:50 → 16:51"] }]);
});
