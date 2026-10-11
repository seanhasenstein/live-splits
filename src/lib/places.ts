import "server-only";
import type { ClientSession, Db } from "mongodb";
import { newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import type { Actor } from "@/lib/db/schema";

export class PlaceError extends Error {}

export type PlaceInput = {
  venueName: string;
  venueCity: string;
  venueState: string;
  date: string;
  /** An existing course at the venue, or "new" to create `newCourseName`; blank = the venue's current layout (created if none). */
  courseId: string;
  newCourseName: string;
};

/**
 * Venue and course for a meet. The venue is matched by name (created if new).
 * Every meet gets a course: the one the coach picked, a new layout they
 * named, or the venue's current layout, created on the spot and named after
 * the venue so course records work from the first meet without anyone
 * having to think about it.
 */
export async function resolvePlace(db: Db, schoolId: string, input: PlaceInput, actor: Actor, session?: ClientSession): Promise<{ venueId: string | null; courseId: string | null }> {
  if (!input.venueName) return { venueId: null, courseId: null };
  const now = new Date();
  const audit = { source: "manual" as const, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, deletedAt: null };
  const year = Number(input.date.slice(0, 4));

  const venues = collection(db, "venues");
  // Same match the form uses (case-insensitive), so "tuscumbia golf course" doesn't become a second venue.
  const nameMatch = { $regex: `^${input.venueName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" };
  let venueId = (await venues.findOne({ schoolId, name: nameMatch, deletedAt: null }, { session }))?._id ?? null;
  if (!venueId) {
    const venue = COLLECTIONS.venues.schema.parse({
      _id: newId(),
      schoolId,
      schemaVersion: COLLECTIONS.venues.version,
      name: input.venueName,
      city: input.venueCity || null,
      state: input.venueState || null,
      notes: null,
      ...audit,
    });
    await venues.insertOne(venue, { session });
    venueId = venue._id;
  }

  const courses = collection(db, "courses");
  if (input.courseId === "new" && !input.newCourseName) throw new PlaceError("Name the new layout, or pick an existing one.");
  if (input.courseId && input.courseId !== "new") {
    const picked = await courses.findOne({ _id: input.courseId, venueId, deletedAt: null }, { session });
    if (picked) return { venueId, courseId: picked._id };
  }
  if (input.courseId !== "new") {
    // The venue's layout in use that year: the open course that started most recently, no later than the meet.
    const current = await courses
      .find({ venueId, deletedAt: null, $or: [{ activeFromYear: null }, { activeFromYear: { $lte: year } }], $and: [{ $or: [{ activeToYear: null }, { activeToYear: { $gte: year } }] }] }, { session })
      .sort({ activeFromYear: -1 })
      .limit(1)
      .next();
    if (current) return { venueId, courseId: current._id };
    // Nothing covers that year yet (history older than the first layout): the earliest layout extends back to it.
    const earliest = await courses.find({ venueId, deletedAt: null }, { session }).sort({ activeFromYear: 1 }).limit(1).next();
    if (earliest && earliest.activeFromYear !== null && earliest.activeFromYear > year) {
      await courses.updateOne({ _id: earliest._id }, { $set: { activeFromYear: year, updatedAt: now, updatedBy: actor } }, { session });
      return { venueId, courseId: earliest._id };
    }
  }
  const course = COLLECTIONS.courses.schema.parse({
    _id: newId(),
    schoolId,
    schemaVersion: COLLECTIONS.courses.version,
    venueId,
    name: input.courseId === "new" && input.newCourseName ? input.newCourseName : input.venueName,
    sport: "xc",
    typicalMeasuredDistance: null,
    activeFromYear: year,
    activeToYear: null,
    notes: null,
    ...audit,
  });
  await courses.insertOne(course, { session });
  return { venueId, courseId: course._id };
}
