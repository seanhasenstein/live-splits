import { z } from "zod";
import {
  DurationMs,
  Id,
  Precision,
  ResultExclusions,
  Source,
  TimingMethod,
  tenantDoc,
} from "./common";

// ---------------------------------------------------------------- marks

/**
 * Typed mark, so track and field fit without a migration.
 * - time: value is integer milliseconds.
 * - distance / height: value is an integer count of `unit`
 *   (mm for metric marks, quarter inches for imperial marks).
 */
export const Mark = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("time"),
    value: DurationMs,
    precision: Precision,
    timingMethod: TimingMethod,
  }),
  z.object({
    type: z.enum(["distance", "height"]),
    value: z.int().nonnegative(),
    unit: z.enum(["mm", "quarter_inch"]),
  }),
]);
export type Mark = z.infer<typeof Mark>;

export const ResultStatus = z.enum(["finished", "dnf", "dnr", "dq", "dns"]);
export type ResultStatus = z.infer<typeof ResultStatus>;

// ---------------------------------------------------------------- results

/**
 * A cumulative time at a checkpoint. App and mat splits are both kept (one
 * entry per checkpoint per source), so comparing them is a query.
 */
export const Split = z.object({
  checkpointId: z.string().min(1),
  cumulativeMs: DurationMs,
  source: Source,
  edited: z.boolean(),
  estimate: z.boolean(),
});
export type Split = z.infer<typeof Split>;

/** Top-30-board entries carry only partial data. */
export const LegacyInfo = z.object({
  name: z.string().min(1),
  year: z.int().nullable(),
  month: z.int().min(1).max(12).nullable(),
  day: z.int().min(1).max(31).nullable(),
  courseId: Id.nullable(),
  meetSeriesId: Id.nullable(),
  note: z.string().nullable(),
});
export type LegacyInfo = z.infer<typeof LegacyInfo>;

export const RelayLeg = z.object({
  athleteId: Id,
  order: z.int().positive(),
  splitMs: DurationMs.nullable(),
});

export const FieldAttempt = z.object({
  order: z.int().positive(),
  outcome: z.enum(["mark", "foul", "pass", "miss"]),
  /** Same unit as the result's mark; for height events, the bar height attempted. */
  value: z.int().nonnegative().nullable(),
  windMps: z.number().nullable(),
});

/** One per athlete per race (one per team for relays). */
export const Result = tenantDoc({
  /** Null only for legacy entries with no race on file. */
  raceId: Id.nullable(),
  /** Null for relays (see legs) and for legacy entries not matched to an athlete. */
  athleteId: Id.nullable(),
  /** Copied from the race so PR/SB grouping never needs a join; set directly on legacy entries. */
  distanceId: Id.nullable(),
  /** Null until a finish is known, and for DNF/DNS/DNR. */
  mark: Mark.nullable(),
  status: ResultStatus,
  place: z.int().positive().nullable(),
  /** Program level id. Ignored for PR/SB. */
  levelId: z.string().min(1).nullable(),
  levelPlace: z.int().positive().nullable(),
  sectionId: z.string().min(1).nullable(),
  /** Grade at the time of the race; nullable, can be backfilled. */
  gradeSnapshot: z.int().nullable(),
  splits: z.array(Split),
  exclusions: ResultExclusions,
  legacy: z.boolean(),
  legacyInfo: LegacyInfo.nullable(),
  /** Set on a legacy entry once the real result is imported; superseded entries are hidden from lists. */
  supersededBy: Id.nullable(),
  raceEntryId: Id.nullable(),
  legs: z.array(RelayLeg),
  attempts: z.array(FieldAttempt),
  windMps: z.number().nullable(),
});
export type Result = z.infer<typeof Result>;

// ---------------------------------------------------------------- raceEntries

/**
 * The full field of a race as published by the timing company (all schools).
 * Re-importing a corrected file soft-deletes that race's previous entries and
 * inserts new ones; our athletes' results are not touched.
 */
export const RaceEntry = tenantDoc({
  raceId: Id,
  importId: Id,
  name: z.string().min(1),
  teamName: z.string().nullable(),
  grade: z.int().nullable(),
  bib: z.string().nullable(),
  place: z.int().positive().nullable(),
  status: ResultStatus,
  timeMs: DurationMs.nullable(),
  precision: Precision.nullable(),
  /** Mat splits as published. checkpointId is set when the split maps to one of our checkpoints. */
  splits: z.array(
    z.object({
      label: z.string().min(1),
      checkpointId: z.string().min(1).nullable(),
      cumulativeMs: DurationMs,
    }),
  ),
  /** Our athlete, when matched by name/alias. */
  athleteId: Id.nullable(),
});
export type RaceEntry = z.infer<typeof RaceEntry>;

// ---------------------------------------------------------------- imports

/** Raw pasted/uploaded source, stored as-is. `source` says what kind; createdAt says when. */
export const Import = tenantDoc({
  meetId: Id.nullable(),
  raceId: Id.nullable(),
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  raw: z.string(),
});
export type Import = z.infer<typeof Import>;
