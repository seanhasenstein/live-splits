export const METERS_PER_MILE = 1609.344;

/** Minutes-per-mile pace for a segment, as ms per mile. */
export const paceMsPerMile = (splitMs: number, segmentMeters: number) => (splitMs * METERS_PER_MILE) / segmentMeters;
