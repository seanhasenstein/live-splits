import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import type { Actor, Meet, Session, SessionRole } from "@/lib/db/schema";
import { generateToken, hashToken } from "./crypto";

export const SESSION_COOKIE = "ls_session";
const SESSION_DAYS = 365;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** The current session, or null. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const sessions = collection(db, "sessions");
  const session = await sessions.findOne({ tokenHash: hashToken(token) });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
  }
  return session;
});

/**
 * Create a session and set its cookie. `meetId` null = school-level coach
 * session (can set up meets); otherwise the session is scoped to one meet.
 */
export async function createSession(input: {
  schoolId: string;
  meetId: string | null;
  role: SessionRole;
  name: string;
}): Promise<Session> {
  const token = generateToken();
  const now = new Date();
  const session = COLLECTIONS.sessions.schema.parse({
    _id: newId(),
    schoolId: input.schoolId,
    schemaVersion: COLLECTIONS.sessions.version,
    kind: "join_code",
    tokenHash: hashToken(token),
    meetId: input.meetId,
    role: input.role,
    name: input.name,
    userId: null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    revokedAt: null,
  });
  await collection(await getDb(), "sessions").insertOne(session);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return session;
}

export async function endSession(): Promise<void> {
  const session = await getSession();
  if (session) {
    await collection(await getDb(), "sessions").updateOne(
      { _id: session._id },
      { $set: { revokedAt: new Date() } },
    );
  }
  (await cookies()).delete(SESSION_COOKIE);
}

export function sessionActor(session: Session): Actor {
  return { type: "session", id: session._id, name: session.name };
}

export type Permission = "setup" | "tap" | "gun" | "fix" | "export" | "view";

const ROLE_PERMISSIONS: Record<SessionRole, Permission[]> = {
  manager: ["tap", "gun", "fix", "view"],
  coach: ["tap", "gun", "fix", "export", "view"],
  viewer: ["view"],
};

/** Whether a session may do `permission` on `meet`. Setup needs a school-level coach session. */
export function can(session: Session | null, permission: Permission, meet: Meet): boolean {
  if (!session || session.schoolId !== meet.schoolId) return false;
  if (session.meetId === null) return session.role === "coach";
  if (session.meetId !== meet._id) return false;
  return ROLE_PERMISSIONS[session.role].includes(permission);
}

export function isSchoolCoach(session: Session | null): boolean {
  return session?.role === "coach" && session.meetId === null;
}
