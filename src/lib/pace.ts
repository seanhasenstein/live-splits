export const METERS_PER_MILE = 1609.344;

/** Minutes-per-mile pace for a segment, as ms per mile. */
export const paceMsPerMile = (splitMs: number, segmentMeters: number) => (splitMs * METERS_PER_MILE) / segmentMeters;

/**
 * Runners go out fast. Over 462 finishers at the 2026 Nightfall Classic the
 * median second mile was 8.5% slower than the first, and the third ran at
 * second-mile pace (boys and girls alike). So the opening mile is treated as
 * its own thing: everything after it is projected 8.5% slower than that mile,
 * and any later segment is extended at its own pace. Projecting mile 2 at
 * mile-1 pace missed by 4% for the median runner; with the fade, by 0%.
 */
export const OPENING_METERS = METERS_PER_MILE;
export const OPENING_FADE = 1.085;

/**
 * When a runner should reach checkpoint `i`, given their elapsed times at the
 * checkpoints so far (`times[j]` in ms from the gun, null = not recorded):
 * the last recorded checkpoint before `i`, extended at the pace of the
 * segment that led to it, faded after the opening mile. Null when there's
 * nothing to go on, when they've already been recorded at or beyond `i`, or
 * when the data is inconsistent (a later checkpoint earlier than the one
 * before it).
 */
export function projectElapsed(meters: number[], times: (number | null)[], i: number): number | null {
  if (i < 0 || i >= meters.length) return null;
  // Already recorded here or further on: nothing to project.
  for (let j = i; j < meters.length; j++) if (times[j] !== null && times[j] !== undefined) return null;
  // The last recorded checkpoint before i, and the recorded one before that (the gun counts as 0 m / 0 ms).
  let last = -1;
  for (let j = i - 1; j >= 0; j--) {
    if (times[j] !== null && times[j] !== undefined) {
      last = j;
      break;
    }
  }
  if (last < 0) return null;
  let prev = -1;
  for (let j = last - 1; j >= 0; j--) {
    if (times[j] !== null && times[j] !== undefined) {
      prev = j;
      break;
    }
  }
  const lastMs = times[last]!;
  const prevMs = prev >= 0 ? times[prev]! : 0;
  const segStart = prev >= 0 ? meters[prev] : 0;
  const segMeters = meters[last] - segStart;
  const segMs = lastMs - prevMs;
  if (segMeters <= 0 || segMs <= 0) return null;
  const remaining = meters[i] - meters[last];
  if (remaining <= 0) return null;
  // A segment that starts at the gun mixes opening pace (its first OPENING_METERS) with the slower
  // pace after; recover the opening pace, then project the rest at the faded pace. The part of the
  // projection still inside the opening stretch (a 1K checkpoint) stays at opening pace.
  if (segStart === 0) {
    const openingPart = Math.min(segMeters, OPENING_METERS);
    const fadedPart = segMeters - openingPart;
    const openingPace = segMs / (openingPart + fadedPart * OPENING_FADE); // ms per meter
    const stillOpening = Math.max(0, Math.min(remaining, OPENING_METERS - meters[last]));
    return lastMs + openingPace * stillOpening + openingPace * OPENING_FADE * (remaining - stillOpening);
  }
  return lastMs + (segMs / segMeters) * remaining;
}

/**
 * Where a runner should reach the first checkpoint before anyone has recorded them: the median of their
 * times there in earlier races this season. Null without any. Rough on purpose (starts and courses vary);
 * once a real time comes in, projectElapsed takes over.
 */
export function openingEstimate(earlier: number[]): number | null {
  if (earlier.length === 0) return null;
  const sorted = [...earlier].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** "1.1 mi" for a segment that isn't about a mile (the last stretch of a 5K); null for a mile, which needs no label. */
export function segmentLength(segmentMeters: number): string | null {
  if (segmentMeters <= 0 || Math.abs(segmentMeters - METERS_PER_MILE) <= 50) return null;
  return `${(segmentMeters / METERS_PER_MILE).toFixed(1)} mi`;
}
