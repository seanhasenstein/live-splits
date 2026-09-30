import type { DistanceUnit, DistanceValue, Sport } from "@/lib/db/schema";

const METERS_PER_UNIT: Record<DistanceUnit, number> = {
  m: 1,
  km: 1000,
  mi: 1609.344,
  yd: 0.9144,
};

export function toMeters(value: number, unit: DistanceUnit): number {
  // Round away float noise (3 mi = 4828.032, not 4828.032000000001).
  return Math.round(value * METERS_PER_UNIT[unit] * 1000) / 1000;
}

export function distanceValue(value: number, unit: DistanceUnit): DistanceValue {
  return { value, unit, meters: toMeters(value, unit) };
}

/** Auto-generated display label: "5K", "3 mi", "800m". */
export function distanceLabel(value: number, unit: DistanceUnit): string {
  if (unit === "km") return `${value}K`;
  if (unit === "m") return `${value}m`;
  return `${value} ${unit}`;
}

/** Readable distance _id: "xc-5000m" for metric, "xc-3mi" otherwise. */
export function distanceId(sport: Sport, value: number, unit: DistanceUnit): string {
  const metric = unit === "m" || unit === "km";
  return metric ? `${sport}-${toMeters(value, unit)}m` : `${sport}-${value}${unit}`;
}
