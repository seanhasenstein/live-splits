import { z } from "zod";
import { DurationMs, Gender, Id, LocalDate, Sport, TimeZone, tenantDoc } from "./common";

// ---------------------------------------------------------------- schools

/** Tenant. A school's own document carries schoolId === _id. */
export const School = tenantDoc({
  name: z.string().min(1),
  shortName: z.string().min(1),
  mascot: z.string().min(1).nullable(),
  state: z.string().length(2),
  settings: z.object({
    /** Default zone for new meets. */
    timeZone: TimeZone,
  }),
});
export type School = z.infer<typeof School>;

// ---------------------------------------------------------------- programs

/**
 * Program-defined labels are data, not enums. Other documents reference the
 * stable `id`; `label` can be renamed freely.
 */
export const LevelLabel = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  abbreviation: z.string().min(1),
});
export type LevelLabel = z.infer<typeof LevelLabel>;

export const RaceCategoryLabel = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Which athletes to offer by default when building a lineup; null = everyone (Open, Mixed). */
  gender: Gender.nullable(),
});
export type RaceCategoryLabel = z.infer<typeof RaceCategoryLabel>;

export const CoachRole = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type CoachRole = z.infer<typeof CoachRole>;

export const ClassYearSystem = z.enum(["hs_grade", "ms_grade", "college_class", "age_group"]);
export type ClassYearSystem = z.infer<typeof ClassYearSystem>;

/** School x sport. */
export const Program = tenantDoc({
  sport: Sport,
  name: z.string().min(1),
  settings: z.object({
    /** Results below this grade are stored but excluded from records. */
    recordsStartGrade: z.int(),
    /** Default N for Top N lists; overridable per query. */
    defaultListLength: z.int().positive(),
    displayUnit: z.enum(["mi", "km"]),
    classYearSystem: ClassYearSystem,
    levels: z.array(LevelLabel),
    raceCategories: z.array(RaceCategoryLabel),
    coachRoles: z.array(CoachRole),
    /** Lists say "history complete from YYYY"; null until history is imported. */
    historyCompleteFromYear: z.int().nullable(),
  }),
});
export type Program = z.infer<typeof Program>;

// ---------------------------------------------------------------- seasons

/**
 * Letter/badge rules are data. Only the rule kinds we know about exist so far;
 * add kinds to this union as programs need them.
 */
export const BadgeRule = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  award: z.enum(["letter", "badge"]),
  rule: z.discriminatedUnion("kind", [
    // "Time under this season's per-meet cutoff."
    z.object({
      kind: z.literal("time_under_meet_cutoff"),
      cutoffs: z.array(
        z.object({ meetId: Id, raceCategoryId: z.string().min(1), cutoffMs: DurationMs }),
      ),
    }),
    // Awarded by hand; the rule only names the award.
    z.object({ kind: z.literal("manual") }),
  ]),
});
export type BadgeRule = z.infer<typeof BadgeRule>;

/** Program x label. Indoor seasons span calendar years, hence explicit dates. */
export const Season = tenantDoc({
  programId: Id,
  label: z.string().min(1),
  startDate: LocalDate,
  endDate: LocalDate,
  badgeRules: z.array(BadgeRule),
});
export type Season = z.infer<typeof Season>;

// ---------------------------------------------------------------- athletes

/** One per person, across sports and seasons. Our athletes only. */
export const Athlete = tenantDoc({
  /** Preferred name; what the app shows. */
  displayName: z.string().min(1),
  officialName: z.string().min(1),
  /** Other spellings seen on timing sites; used to match imports. */
  aliases: z.array(z.string().min(1)),
  gender: Gender,
  /** Null for alumni with unknown year, or not yet known. */
  graduationYear: z.int().nullable(),
  /** Clubs / age-group programs. */
  birthYear: z.int().nullable(),
  athleticNetId: z.string().min(1).nullable(),
});
export type Athlete = z.infer<typeof Athlete>;

// ---------------------------------------------------------------- seasonRosters

/** Athlete x season. */
export const SeasonRoster = tenantDoc({
  seasonId: Id,
  athleteId: Id,
  /** Program level id (programs.settings.levels[].id). */
  defaultLevelId: z.string().min(1),
});
export type SeasonRoster = z.infer<typeof SeasonRoster>;
