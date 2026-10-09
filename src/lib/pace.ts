export const METERS_PER_MILE = 1609.344;

/** Minutes-per-mile pace for a segment, as ms per mile. */
export const paceMsPerMile = (splitMs: number, segmentMeters: number) => (splitMs * METERS_PER_MILE) / segmentMeters;

/**
 * When a runner should reach checkpoint `i`, given their elapsed times at the
 * checkpoints so far (`times[j]` in ms from the gun, null = not recorded):
 * the last recorded checkpoint before `i`, extended at the pace of the
 * segment that led to it. Null when there's nothing to go on, when they've
 * already been recorded at or beyond `i`, or when the data is inconsistent
 * (a later checkpoint earlier than the one before it).
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
  const segMeters = meters[last] - (prev >= 0 ? meters[prev] : 0);
  const segMs = lastMs - prevMs;
  if (segMeters <= 0 || segMs <= 0) return null;
  const remaining = meters[i] - meters[last];
  if (remaining <= 0) return null;
  return lastMs + (segMs / segMeters) * remaining;
}
