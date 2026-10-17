import { describe, expect, it } from "vitest";
import { METERS_PER_MILE, OPENING_FADE, paceMsPerMile, projectElapsed } from "./pace";

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

  it("after the opening mile, projects the rest 8.5% slower than that mile", () => {
    const times = [m(7), null, null];
    expect(Math.round(projectElapsed(course, times, 1)!)).toBe(Math.round(m(7) + m(7) * OPENING_FADE)); // 14:35.7, not 14:00
    expect(Math.round(projectElapsed(course, times, 2)! / 1000)).toBe(Math.round((m(7) + (m(7) * OPENING_FADE * (5000 - MI)) / MI) / 1000)); // 22:00
  });

  it("the fade is what the mats showed at Nightfall 2026: median runner, Mile 1 6:49.1 → Mile 2 13:37.6", () => {
    // Actual second mile 6:48.5 was this runner's own; the population median is 8.5% slower. The
    // projection from Mile 1 alone lands within the data's spread rather than 4% early.
    const projected = projectElapsed(course, [m(6, 49.1), null, null], 1)!;
    expect(projected).toBeGreaterThan(m(13, 37.6) * 0.99);
    expect(projected).toBeLessThan(m(14, 50));
  });

  it("a 1K checkpoint inside the opening mile is projected at opening pace", () => {
    const k = [1000, MI, 2 * MI, 5000];
    const t = projectElapsed(k, [m(4), null, null, null], 1)!; // 4:00 at 1K → mile at same pace: 6:26.2
    expect(Math.round(t)).toBe(Math.round(m(4) * (MI / 1000)));
  });

  it("never projects a checkpoint at or before one already recorded", () => {
    expect(projectElapsed(course, [null, m(14), null], 0)).toBeNull(); // Mile 1 missed, Mile 2 in
    expect(projectElapsed(course, [m(7), m(14), null], 1)).toBeNull();
    expect(projectElapsed(course, [m(7), null, m(21)], 1)).toBeNull(); // finished: nothing to guess
  });

  it("skips a missed checkpoint when finding the pace segment, and unmixes the opening mile from it", () => {
    // Mile 1 missed, Mile 2 at 14:00: the two miles were an opening mile plus one 8.5% slower, so the
    // rest goes at that slower pace (7:17/mi), not the 7:00 average.
    const t = projectElapsed(course, [null, m(14), null], 2)!;
    const opening = m(14) / (MI + MI * OPENING_FADE);
    expect(Math.round(t)).toBe(Math.round(m(14) + opening * OPENING_FADE * (5000 - 2 * MI)));
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
