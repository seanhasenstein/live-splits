import { z } from "zod";
import { Actor, DistanceValue, EpochMs, Id, LocalDate, SchemaVersion, tenantDoc } from "./common";

/**
 * Workouts: practice sessions timed rep by rep. A workout is a plan (sets of
 * reps, each followed by a rest), the athletes in it with their goals, and the
 * groups they run in. What happened is an append-only event log, replayed the
 * same way race taps are (see src/lib/workout-replay.ts). See WORKOUTS.md.
 */

/**
 * What follows a rep or a set.
 * - time: a fixed rest ("60 s"), from when the group finished the rep.
 * - interval: on the clock ("every 3:00"): the next rep starts that long after this one started.
 * - jog: a recovery jog of a distance; nothing to time.
 * - open: until the coach starts the next rep.
 */
export const Rest = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("time"), ms: z.int().positive() }),
  z.object({ kind: z.literal("interval"), everyMs: z.int().positive() }),
  z.object({ kind: z.literal("jog"), meters: z.number().positive() }),
  z.object({ kind: z.literal("open") }),
]);
export type Rest = z.infer<typeof Rest>;

/** One rep. Ids are stable for the life of the workout so events can point at them. */
export const Rep = z.object({
  id: z.string().min(1),
  distance: DistanceValue,
  /** After this rep, within its set. The last rep of a set uses the set's restAfter instead. */
  rest: Rest,
});
export type Rep = z.infer<typeof Rep>;

export const RepSet = z.object({
  id: z.string().min(1),
  reps: z.array(Rep).min(1),
  /** Between this set and the next. Null on the last set. */
  restAfter: Rest.nullable(),
});
export type RepSet = z.infer<typeof RepSet>;

/** Why the workout is run, which sets each athlete's default goal pace from their 5K. */
export const WorkoutEffort = z.enum(["vo2", "threshold", "tempo", "race", "custom"]);
export type WorkoutEffort = z.infer<typeof WorkoutEffort>;

export const WorkoutGroup = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type WorkoutGroup = z.infer<typeof WorkoutGroup>;

export const WorkoutAthlete = z.object({
  athleteId: Id,
  /** The group they start in; moves during the workout are events. */
  groupId: z.string().min(1),
  /** Goal pace in ms per km. Null = no goal. A rep's goal time is this pace over the rep's distance. */
  goalPaceMsPerKm: z.int().positive().nullable(),
});
export type WorkoutAthlete = z.infer<typeof WorkoutAthlete>;

/** Who can see the workout. Starts staff-only; the field exists so opening it up is a setting, not a migration. */
export const WorkoutVisibility = z.enum(["staff", "athletes", "team"]);
export type WorkoutVisibility = z.infer<typeof WorkoutVisibility>;

export const Workout = tenantDoc({
  programId: Id,
  seasonId: Id,
  name: z.string().min(1),
  date: LocalDate,
  timeZone: z.string().min(1),
  /** Where, free text ("school grounds, grass loop"). Distances there may be approximate. */
  place: z.string().nullable(),
  /** True on grass or anywhere the distances are approximate: paces are shown as rough. */
  approximateDistances: z.boolean(),
  effort: WorkoutEffort,
  sets: z.array(RepSet).min(1),
  groups: z.array(WorkoutGroup).min(1),
  athletes: z.array(WorkoutAthlete),
  visibility: WorkoutVisibility,
  notes: z.string().nullable(),
  /** Set when the coach ends the workout. */
  finishedAt: z.date().nullable(),
  /** The template this was made from, if any. */
  templateId: Id.nullable(),
});
export type Workout = z.infer<typeof Workout>;

/** A saved plan to start new workouts from. */
export const WorkoutTemplate = tenantDoc({
  programId: Id,
  name: z.string().min(1),
  effort: WorkoutEffort,
  sets: z.array(RepSet).min(1),
  approximateDistances: z.boolean(),
});
export type WorkoutTemplate = z.infer<typeof WorkoutTemplate>;

export const WorkoutEventType = z.enum([
  "rep_start", // a group (athleteId null) or one athlete (staggered) started repId
  "rest_start", // the coach started the group's rest after repId, before everyone was in
  "finish", // athleteId finished repId
  "skip", // athleteId (or the whole group when null) skips repId
  "stop", // athleteId is done for the day, from repId on (not run)
  "rejoin", // athleteId is back from repId on, after a stop
  "move", // athleteId runs in groupId from repId on (also: a late arrival joining)
  "edit", // change the time of an earlier event (targetEventId) to timeMs
  "void", // cancel an earlier event (targetEventId)
  "note", // free text on a rep, for a group or an athlete
  "hold", // the group's rest after repId has no countdown: a water break, a weather delay; the next rep starts when the coach says
  "group_end", // the group stops after repId: the reps after it aren't run
  "time", // athleteId ran repId in timeMs (a rep time, not a clock time): typed in from a watch or the paper sheet
]);
export type WorkoutEventType = z.infer<typeof WorkoutEventType>;

/** Append-only, like race taps: never updated; corrections are new events. */
export const WorkoutEvent = z.object({
  _id: Id,
  schoolId: Id,
  schemaVersion: SchemaVersion,
  /** Generated on the device; unique. Makes retries idempotent. */
  clientEventId: z.string().min(1),
  workoutId: Id,
  type: WorkoutEventType,
  groupId: z.string().min(1).nullable(),
  athleteId: Id.nullable(),
  repId: z.string().min(1).nullable(),
  targetEventId: z.string().min(1).nullable(),
  deviceTimeMs: EpochMs,
  clockOffsetMs: z.int(),
  serverTimeMs: EpochMs,
  /** The time this event asserts when it isn't the moment of the tap (typed or nudged). Null = serverTimeMs. */
  timeMs: EpochMs.nullable(),
  note: z.string().nullable(),
  createdAt: z.date(),
  createdBy: Actor,
});
export type WorkoutEvent = z.infer<typeof WorkoutEvent>;
