import { z } from "zod";
import {
  Actor,
  DistanceUnit,
  DistanceValue,
  Id,
  SchemaVersion,
  Sport,
  tenantDoc,
} from "./common";

// ---------------------------------------------------------------- distances

/**
 * Shared distance definitions (not tenant-owned: schoolId is null for the
 * preloaded set, or the school that added a custom one). PRs/SBs group by this
 * _id, never by comparing meters. Unique on (sport, value, unit).
 */
export const Distance = z.object({
  _id: Id, // readable slug, e.g. "xc-5000m", "xc-3mi"
  schoolId: Id.nullable(),
  schemaVersion: SchemaVersion,
  sport: Sport,
  value: z.number().positive(),
  unit: DistanceUnit,
  /** Calculated from value + unit. */
  meters: z.number().positive(),
  /** Auto-generated but editable; display only, never used for logic. */
  label: z.string().min(1),
  createdAt: z.date(),
  createdBy: Actor,
  updatedAt: z.date(),
  updatedBy: Actor,
  deletedAt: z.date().nullable(),
});
export type Distance = z.infer<typeof Distance>;

export const MeasuredDistance = DistanceValue.extend({
  method: z.enum(["wheel", "gps_median", "certified"]),
  note: z.string().nullable(),
});
export type MeasuredDistance = z.infer<typeof MeasuredDistance>;

// ---------------------------------------------------------------- venues

/** Physical location. */
export const Venue = tenantDoc({
  name: z.string().min(1),
  city: z.string().nullable(),
  state: z.string().length(2).nullable(),
  notes: z.string().nullable(),
});
export type Venue = z.infer<typeof Venue>;

// ---------------------------------------------------------------- courses

/** A specific layout at a venue. A changed layout is a new course. */
export const Course = tenantDoc({
  venueId: Id,
  name: z.string().min(1),
  sport: Sport,
  /** Perspective only; times are never adjusted. */
  typicalMeasuredDistance: MeasuredDistance.nullable(),
  activeFromYear: z.int().nullable(),
  activeToYear: z.int().nullable(),
  notes: z.string().nullable(),
});
export type Course = z.infer<typeof Course>;

// ---------------------------------------------------------------- meetSeries

/** The annual meet as an ongoing event (e.g. Crusader Challenge). */
export const MeetSeries = tenantDoc({
  programId: Id,
  name: z.string().min(1),
  notes: z.string().nullable(),
});
export type MeetSeries = z.infer<typeof MeetSeries>;
