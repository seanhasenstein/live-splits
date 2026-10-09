import { describe, expect, it } from "vitest";
import { METERS_PER_MILE, paceMsPerMile, projectElapsed } from "./pace";

const MI = METERS_PER_MILE;
// Mile 1, Mile 2, Finish (5K): the last leg is 1.107 mi.
const course = [MI, 2 * MI, 5000];
const m = (min: number, s = 0) => (min * 60 + s) * 1000;

describe("projectElapsed", () => {
  it("extends the last segment's pace over the exact remaining distance", () => {
    // 6:49.1 then 13:37.6 (second mile 6:48.5) → finish 1781 m later at 6:48.5/mi pace
    const t = projectElapsed(course, [m(6, 49.1), m(13, 37.6), null], 2)!;
    const expected = m(13, 37.6) + (m(6, 48.5) / MI) * (5000 - 2 * MI);
    expect(Math.round(t)).toBe(Math.round(expected));
    expect(Math.round(t / 1000)).toBe(21 * 60 + 10); // 21:10, not 20:26 (a flat "+ one mile")
  });

  it("projects every unrecorded checkpoint after the last real one, from the first segment when only Mile 1 is in", () => {
    const times = [m(7), null, null];
    expect(projectElapsed(course, times, 1)).toBe(m(14));
    // Finish is 3390.7 m past Mile 1 at 7:00/mi → 21:45
    expect(Math.round(projectElapsed(course, times, 2)! / 1000)).toBe(Math.round((m(7) + (m(7) / MI) * (5000 - MI)) / 1000));
  });

  it("never projects a checkpoint at or before one already recorded", () => {
    expect(projectElapsed(course, [null, m(14), null], 0)).toBeNull(); // Mile 1 missed, Mile 2 in
    expect(projectElapsed(course, [m(7), m(14), null], 1)).toBeNull();
    expect(projectElapsed(course, [m(7), null, m(21)], 1)).toBeNull(); // finished: nothing to guess
  });

  it("skips a missed checkpoint when finding the pace segment", () => {
    // Mile 1 missed, Mile 2 at 14:00 → segment is gun→Mile 2 (2 mi in 14:00 = 7:00/mi)
    const t = projectElapsed(course, [null, m(14), null], 2)!;
    expect(Math.round(t)).toBe(Math.round(m(14) + (m(7) / MI) * (5000 - 2 * MI)));
  });

  it("returns null without any data, and on inconsistent data", () => {
    expect(projectElapsed(course, [null, null, null], 2)).toBeNull();
    expect(projectElapsed(course, [m(7), m(6), null], 2)).toBeNull(); // Mile 2 before Mile 1
    expect(projectElapsed([MI, MI, 5000], [m(7), m(7, 1), null], 2)).toBeNull(); // zero-length segment
    expect(projectElapsed(course, [m(7)], 5)).toBeNull(); // out of range
  });

  it("pace per mile uses the segment's own distance", () => {
    expect(Math.round(paceMsPerMile(m(7, 20.5), 5000 - 2 * MI) / 1000)).toBe(6 * 60 + 38);
  });
});
