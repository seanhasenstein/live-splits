import { z } from "zod";
import { Actor, EpochMs, Id, SchemaVersion } from "./common";

export const TapType = z.enum([
  "gun", // race started
  "capture", // unnamed timestamp slot at a checkpoint
  "assign", // give a capture slot (targetTapId) to an athlete
  "name_tap", // athlete + time in one tap; also manual adds (timeMs + estimate)
  "edit", // correct an earlier tap (targetTapId): move athlete, change time, mark missed
  "void", // cancel an earlier tap (targetTapId): undo, delete
  "status", // athlete didn't start / didn't run / dropped out (status; checkpointId = last one passed for dnf)
  "tick", // a runner passing a checkpoint, counted for places (team: "us", "other" or a tracked team's id)
]);
export type TapType = z.infer<typeof TapType>;

/** Why an athlete has no finish: didn't start, didn't run (scratched), didn't finish. */
export const AthleteRaceStatus = z.enum(["dns", "dnr", "dnf"]);
export type AthleteRaceStatus = z.infer<typeof AthleteRaceStatus>;

/**
 * Append-only raw log from the app. Never updated or deleted; corrections are
 * new events that point at an earlier one. Result splits are derived by
 * replaying a race's taps in order.
 */
export const Tap = z.object({
  _id: Id,
  schoolId: Id,
  schemaVersion: SchemaVersion,
  /** Generated on the device; unique. Makes retries idempotent. */
  clientTapId: z.string().min(1),
  type: TapType,
  meetId: Id,
  raceId: Id,
  /** Null for gun. */
  checkpointId: z.string().min(1).nullable(),
  /** name_tap / assign; edit when moving a time to another athlete or marking an athlete missed. */
  athleteId: Id.nullable(),
  /** clientTapId of the tap this one assigns, edits or voids. */
  targetTapId: z.string().min(1).nullable(),

  /** Device clock when the tap happened. */
  deviceTimeMs: EpochMs,
  /** Device-to-server offset in effect (server = device + offset); may be negative. */
  clockOffsetMs: z.int(),
  /** deviceTimeMs + clockOffsetMs. When the tap happened on the server's clock. */
  serverTimeMs: EpochMs,

  /**
   * The absolute time this event asserts, when that is not the moment of the
   * tap itself: typed/nudged times, manual adds, gun set from official results.
   * Null = use serverTimeMs.
   */
  timeMs: EpochMs.nullable(),
  estimate: z.boolean(),
  /** edit only: the athlete passed this checkpoint but was not captured. */
  missed: z.boolean(),
  /** status only. Older taps lack the field. */
  status: AthleteRaceStatus.nullable().default(null),
  /**
   * tick: who passed ("us" = one of ours, "other" = anyone untracked, else a tracked team's id).
   * edit of a tick: the corrected team. Older taps lack the field.
   */
  team: z.string().min(1).max(40).nullable().default(null),
  note: z.string().nullable(),

  /** When the server stored it (taps can arrive late from the local queue). */
  createdAt: z.date(),
  createdBy: Actor,
});
export type Tap = z.infer<typeof Tap>;
