import { z } from "zod";

// Every _id and reference is a string (ObjectId hex from newId(), or a readable
// slug for distances). Strings pass through JSON, cookies and IndexedDB unchanged.
export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

export const SchemaVersion = z.int().positive();

/** Where a piece of data came from. */
export const Source = z.enum([
  "app",
  "mat",
  "athleticnet",
  "pttiming",
  "manual",
  "legacy_board",
]);
export type Source = z.infer<typeof Source>;

/**
 * Who created/updated a document. MVP actors are join-code sessions (first name
 * only); `user` arrives with email PIN auth; `system` covers seeds and imports.
 */
export const Actor = z.object({
  type: z.enum(["system", "session", "user"]),
  id: Id.nullable(),
  name: z.string().min(1),
});
export type Actor = z.infer<typeof Actor>;

/** Durations: always integer milliseconds. */
export const DurationMs = z.int().nonnegative();

/** Absolute instants used for timing (gun, taps): integer epoch milliseconds (UTC). */
export const EpochMs = z.int().positive();

/** How many decimals a time carries: an official sheet in whole seconds, a chip system in hundredths. */
export const Precision = z.enum(["seconds", "tenths", "hundredths", "thousandths"]);
export type Precision = z.infer<typeof Precision>;

export const TimingMethod = z.enum(["fat", "hand", "rfid", "app"]);
export type TimingMethod = z.infer<typeof TimingMethod>;

/** Calendar date with no time or zone, e.g. "2026-10-02". */
export const LocalDate = z.iso.date();

export const TimeZone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { error: "Must be an IANA time zone, e.g. America/Chicago" },
);

export const Sport = z.enum(["xc", "track_outdoor", "track_indoor"]);
export type Sport = z.infer<typeof Sport>;

export const Gender = z.enum(["F", "M", "X"]);
export type Gender = z.infer<typeof Gender>;

export const DistanceUnit = z.enum(["m", "km", "mi", "yd"]);
export type DistanceUnit = z.infer<typeof DistanceUnit>;

/**
 * One shape for every distance: distance definitions, checkpoints, measured
 * distances. `meters` is calculated from value + unit (see lib/distance.ts) and
 * is for ordering/display math only; never compare meters to group results.
 */
export const DistanceValue = z.object({
  value: z.number().positive(),
  unit: DistanceUnit,
  meters: z.number().positive(),
});
export type DistanceValue = z.infer<typeof DistanceValue>;

/** Fields shared by every tenant-owned document. */
const auditShape = {
  source: Source,
  createdAt: z.date(),
  createdBy: Actor,
  updatedAt: z.date(),
  updatedBy: Actor,
  deletedAt: z.date().nullable(),
};

export function tenantDoc<T extends z.ZodRawShape>(shape: T) {
  return z.object({
    _id: Id,
    schoolId: Id,
    schemaVersion: SchemaVersion,
    ...shape,
    ...auditShape,
  });
}

/**
 * Exclusion flags on a race. Any flag set requires a reason.
 */
export const RaceExclusions = z
  .object({
    excludeFromPrSb: z.boolean(),
    excludeFromCourseLists: z.boolean(),
    excludeFromMeetLists: z.boolean(),
    exclusionReason: z.string().min(1).nullable(),
  })
  .refine(
    (e) =>
      e.exclusionReason !== null ||
      !(e.excludeFromPrSb || e.excludeFromCourseLists || e.excludeFromMeetLists),
    { error: "exclusionReason is required when any exclusion flag is set", path: ["exclusionReason"] },
  );
export type RaceExclusions = z.infer<typeof RaceExclusions>;

/**
 * Result-level exclusions override the race's flags: null = inherit from the
 * race, true/false = override. Any override requires a reason.
 */
export const ResultExclusions = z
  .object({
    excludeFromPrSb: z.boolean().nullable(),
    excludeFromCourseLists: z.boolean().nullable(),
    excludeFromMeetLists: z.boolean().nullable(),
    exclusionReason: z.string().min(1).nullable(),
  })
  .refine(
    (e) =>
      e.exclusionReason !== null ||
      (e.excludeFromPrSb === null &&
        e.excludeFromCourseLists === null &&
        e.excludeFromMeetLists === null),
    { error: "exclusionReason is required when any exclusion flag is overridden", path: ["exclusionReason"] },
  );
export type ResultExclusions = z.infer<typeof ResultExclusions>;
