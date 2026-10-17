import { z } from "zod";
import {
  DistanceValue,
  EpochMs,
  Id,
  LocalDate,
  RaceExclusions,
  TimeZone,
  tenantDoc,
} from "./common";
import { MeasuredDistance } from "./places";

// ---------------------------------------------------------------- meets

export const Weather = z.object({
  tempF: z.number().nullable(),
  windMph: z.number().nullable(),
  conditions: z.string().nullable(),
  notes: z.string().nullable(),
});
export type Weather = z.infer<typeof Weather>;

export const Meet = tenantDoc({
  programId: Id,
  seasonId: Id,
  meetSeriesId: Id.nullable(),
  venueId: Id.nullable(),
  courseId: Id.nullable(),
  name: z.string().min(1),
  /** Local calendar date + IANA zone, so a Friday night meet never shows as Saturday. */
  date: LocalDate,
  timeZone: TimeZone,
  weather: Weather.nullable(),
  /**
   * Set when nothing from this meet should count for PRs, season bests or course bests
   * (a short course, a rerouted race). Results are kept and shown; records ignore them.
   */
  recordsExclusion: z.object({ reason: z.string().min(1).nullable() }).nullable().default(null),
  /** The timing company's page for this meet (live timing / results), linked from the meet page. */
  resultsUrl: z.url().nullable().default(null),
  /**
   * Join codes: a keyed hash for lookup (what the person typed is hashed and
   * matched) plus the code encrypted at rest, so coaches can see and re-share
   * it. The viewer token backs the read-only link.
   */
  joinCodes: z.object({
    managerCodeHash: z.string().min(1).nullable(),
    coachCodeHash: z.string().min(1).nullable(),
    viewerTokenHash: z.string().min(1).nullable(),
    managerCodeEnc: z.string().min(1).nullable(),
    coachCodeEnc: z.string().min(1).nullable(),
    viewerTokenEnc: z.string().min(1).nullable(),
  }),
});
export type Meet = z.infer<typeof Meet>;

// ---------------------------------------------------------------- races

export const Checkpoint = z.object({
  /** Stable within the race; splits and taps reference it. */
  id: z.string().min(1),
  label: z.string().min(1),
  distance: DistanceValue,
  kind: z.enum(["split", "finish"]),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

/** Track heats/sections. Empty for XC. */
export const RaceSection = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  gunTimeMs: EpochMs.nullable(),
});
export type RaceSection = z.infer<typeof RaceSection>;

/**
 * Team results exactly as published. Scoring rules vary by meet, so the
 * official numbers are stored rather than calculated.
 */
export const TeamScoring = z.object({
  /** Program level id this scoring covers; null = the whole race. */
  levelId: z.string().min(1).nullable(),
  teamsScored: z.int().nonnegative(),
  teams: z.array(
    z.object({
      name: z.string().min(1),
      place: z.int().positive().nullable(),
      points: z.number().nullable(),
      isOurTeam: z.boolean(),
    }),
  ),
});
export type TeamScoring = z.infer<typeof TeamScoring>;

/** A team whose runners get their own button when counting places. */
export const TrackedTeam = z.object({
  /** Stable within the race; ticks reference it. */
  id: z.string().regex(/^t_[A-Za-z0-9]+$/),
  /** As the timing company writes it, e.g. "Kimberly". */
  name: z.string().trim().min(1).max(60),
  /** The button label, e.g. "KIM". */
  short: z.string().trim().min(1).max(6),
  /** A palette key (see PLACE_COLORS), so buttons stay readable in light and dark. */
  color: z.string().min(1).max(20),
  /** Other spellings to match in results ("Kimberly High School"). */
  aliases: z.array(z.string().trim().min(1).max(60)).max(5).default([]),
});
export type TrackedTeam = z.infer<typeof TrackedTeam>;

/** "Places 1–10: First team all-conference." */
export const AwardLine = z.object({ through: z.int().positive().max(999), label: z.string().trim().min(1).max(40) });
export type AwardLine = z.infer<typeof AwardLine>;

/** Counting places at checkpoints: off unless a race turns it on. */
export const RacePlaces = z.object({
  on: z.boolean(),
  teams: z.array(TrackedTeam).max(6),
  /** Best first: [{ through: 10, … }, { through: 20, … }]. */
  awards: z.array(AwardLine).max(5),
  /** Places, scores and award lines on the live board for everyone, not just coaches and managers. */
  public: z.boolean(),
});
export type RacePlaces = z.infer<typeof RacePlaces>;

export const EventKind =z.enum(["run", "relay", "field_distance", "field_height"]);
export type EventKind = z.infer<typeof EventKind>;

/** An event/race within a meet. */
export const Race = tenantDoc({
  meetId: Id,
  name: z.string().min(1),
  /** Position in the meet schedule. */
  order: z.int().nonnegative(),
  /** Local wall-clock start, "HH:mm", in the meet's time zone. */
  scheduledStart: z.iso.time({ precision: -1 }).nullable(),
  eventKind: EventKind,
  /** Program race category id (programs.settings.raceCategories[].id). */
  raceCategoryId: z.string().min(1),
  /** Program level ids included, e.g. ["varsity", "jv"] when they run together. */
  levelIds: z.array(z.string().min(1)),
  /** Null only for field events. */
  distanceId: Id.nullable(),
  measuredDistance: MeasuredDistance.nullable(),
  /**
   * Current gun time (absolute). The tap log keeps every gun tap and edit;
   * this is the value in effect.
   */
  gunTimeMs: EpochMs.nullable(),
  gunTimeSource: z.enum(["tap", "official_results", "manual"]).nullable(),
  /** Set when a coach marks the race finished: the clock stops ticking and the board becomes the review screen. */
  finishedAt: z.date().nullable(),
  /** The import that supplied this race's official results, if any. Official times then take precedence over app taps. */
  officialImportId: Id.nullable(),
  /**
   * The official sheet scored a bigger field (divisions run together); the import kept our
   * division's teams and the app ranked them by time. Times are official, places are the app's.
   */
  placesDerived: z.boolean().default(false),
  /**
   * The timing company's live feed for this race (a RACE RESULT contest URL),
   * polled while the race is in progress so official finishes show on the
   * board as they post. Ignored once results are imported.
   */
  liveFeed: z.object({ url: z.url(), contestName: z.string().nullable() }).nullable().default(null),
  /** Counting places at checkpoints (tracked teams, award lines). Null: never set up. */
  places: RacePlaces.nullable().default(null),
  checkpoints: z.array(Checkpoint),
  /** Which of our athletes run in this race, and at which level. */
  lineup: z.array(z.object({ athleteId: Id, levelId: z.string().min(1) })),
  sections: z.array(RaceSection),
  teamScoring: z.array(TeamScoring),
  exclusions: RaceExclusions,
});
export type Race = z.infer<typeof Race>;
