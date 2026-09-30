import type { Collection, Db } from "mongodb";
import type { z } from "zod";
import {
  Athlete,
  Course,
  Distance,
  Import,
  Meet,
  MeetSeries,
  Pin,
  Program,
  Race,
  RaceEntry,
  Result,
  School,
  Season,
  SeasonRoster,
  Session,
  Tap,
  User,
  Venue,
} from "./schema";

/**
 * Every collection, its Zod schema, and the schemaVersion new documents get.
 * Bump a version when a collection's shape changes and note it in SCHEMA.md.
 */
export const COLLECTIONS = {
  schools: { schema: School, version: 1 },
  programs: { schema: Program, version: 1 },
  seasons: { schema: Season, version: 1 },
  athletes: { schema: Athlete, version: 1 },
  seasonRosters: { schema: SeasonRoster, version: 1 },
  distances: { schema: Distance, version: 1 },
  venues: { schema: Venue, version: 1 },
  courses: { schema: Course, version: 1 },
  meetSeries: { schema: MeetSeries, version: 1 },
  meets: { schema: Meet, version: 1 },
  races: { schema: Race, version: 1 },
  results: { schema: Result, version: 1 },
  raceEntries: { schema: RaceEntry, version: 1 },
  imports: { schema: Import, version: 1 },
  taps: { schema: Tap, version: 1 },
  users: { schema: User, version: 1 },
  sessions: { schema: Session, version: 1 },
  pins: { schema: Pin, version: 1 },
} as const;

export type CollectionName = keyof typeof COLLECTIONS;
export type DocOf<N extends CollectionName> = z.infer<(typeof COLLECTIONS)[N]["schema"]>;

export function collection<N extends CollectionName>(db: Db, name: N): Collection<DocOf<N>> {
  return db.collection<DocOf<N>>(name);
}
