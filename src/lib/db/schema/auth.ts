import { z } from "zod";
import { Id, SchemaVersion } from "./common";

// MVP uses join-code sessions only. users and pins are here so email PIN auth
// (hashed PIN, short expiry, attempt/resend limits, long sessions) drops in later.

export const User = z.object({
  _id: Id,
  schoolId: Id,
  schemaVersion: SchemaVersion,
  email: z.email(),
  name: z.string().min(1),
  /** Program coach role ids, per program. */
  roles: z.array(z.object({ programId: Id, coachRoleId: z.string().min(1) })),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
});
export type User = z.infer<typeof User>;

export const SessionRole = z.enum(["manager", "coach", "viewer"]);
export type SessionRole = z.infer<typeof SessionRole>;

export const Session = z.object({
  _id: Id,
  schoolId: Id,
  schemaVersion: SchemaVersion,
  kind: z.enum(["join_code", "user"]),
  /** Hash of the cookie token; the raw token lives only in the httpOnly cookie. */
  tokenHash: z.string().min(1),
  /** join_code sessions are scoped to one meet. */
  meetId: Id.nullable(),
  role: SessionRole,
  /** First name given when joining; stored on every tap. */
  name: z.string().min(1),
  userId: Id.nullable(),
  createdAt: z.date(),
  lastSeenAt: z.date(),
  expiresAt: z.date(),
  revokedAt: z.date().nullable(),
  /** Where this person's record screen is pointed right now, so coaches can see who's covering which checkpoint. */
  /** Where this person's record screen is, and their job there (times, places or both; older sessions lack it). */
  presence: z.object({ raceId: Id, checkpointId: z.string().min(1), job: z.enum(["times", "places", "both"]).optional(), at: z.date() }).nullable().default(null),
  /** The same for a workout: which group this person is timing. */
  workoutPresence: z.object({ workoutId: Id, groupId: z.string().min(1), at: z.date() }).nullable().default(null),
});
export type Session = z.infer<typeof Session>;

export const Pin = z.object({
  _id: Id,
  schoolId: Id,
  schemaVersion: SchemaVersion,
  userId: Id,
  pinHash: z.string().min(1),
  attempts: z.int().nonnegative(),
  resendCount: z.int().nonnegative(),
  lastSentAt: z.date(),
  expiresAt: z.date(),
  consumedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type Pin = z.infer<typeof Pin>;
