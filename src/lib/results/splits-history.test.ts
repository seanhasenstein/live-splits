import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { METERS_PER_MILE } from "@/lib/pace";
import { parseLongDate, parseSplitsHistory } from "./splits-history";

const text = readFileSync(`${process.cwd()}/src/lib/results/fixtures/splits-history.txt`, "utf8");

test("long dates", () => {
  expect(parseLongDate("August 28th 2025")).toBe("2025-08-28");
  expect(parseLongDate("September 3, 2024")).toBe("2024-09-03");
  expect(parseLongDate("Oct 2nd 2026")).toBe("2026-10-02");
  expect(parseLongDate("28 August 2025")).toBeNull();
});

test("a meet's two tables become one meet with splits, finishes, places, levels, DNFs; blank rows are skipped", () => {
  const meets = parseSplitsHistory(text);
  expect(meets).toHaveLength(1);
  const m = meets[0];
  expect(m.name).toBe("Kettle Moraine Lutheran Invite");
  expect(m.date).toBe("2025-08-28");
  expect(m.checkpoints).toEqual([
    { label: "Mile 1", meters: METERS_PER_MILE },
    { label: "Mile 2", meters: 2 * METERS_PER_MILE },
  ]);
  expect(m.distanceMeters).toBe(5000);
  expect(m.summaries).toHaveLength(3);
  expect(m.rows).toHaveLength(21); // 27 names, 6 didn't run

  const titus = m.rows.find((r) => r.name === "Titus Gottschalk")!;
  expect(titus).toMatchObject({ gender: "M", level: "varsity", finishMs: 18 * 60_000 + 13_000, place: 11, status: "finished", letter: true });
  expect(titus.splits).toEqual({ "Mile 1": 5 * 60_000 + 46_000, "Mile 2": 11 * 60_000 + 47_000 }); // 5:46 + 6:01

  const ajani = m.rows.find((r) => r.name === "Ajani Laster")!;
  expect(ajani).toMatchObject({ level: "jv", place: 20, letter: false });

  // Segment times add up to the finish for every finisher.
  for (const r of m.rows.filter((r) => r.status === "finished")) {
    expect(r.finishMs).not.toBeNull();
  }
  const dnfs = m.rows.filter((r) => r.status === "dnf");
  expect(dnfs.map((r) => [r.gender, Object.keys(r.splits).length, r.finishMs, r.place])).toEqual([
    ["M", 1, null, null], // 10:31 then DNF
    ["F", 2, null, null], // Mikayla: two splits then DNF
  ]);
  expect(m.rows.filter((r) => r.gender === "F")).toHaveLength(7);
  expect(m.rows.some((r) => r.name === "Emma Winter")).toBe(false); // blank row
});
