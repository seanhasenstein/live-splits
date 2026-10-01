"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hashCode, normalizeCode, safeEqual } from "@/lib/auth/crypto";
import { createSession, endSession } from "@/lib/auth/session";
import { getOnlySchool } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";

export type FormState = { error?: string };

const JoinForm = z.object({
  code: z.string().trim().min(1, "Enter a code"),
  name: z.string().trim().min(1, "Enter your first name").max(40),
});

export async function joinAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = JoinForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { code, name } = parsed.data;

  // Coach access code (env) opens meet setup for the school.
  const coachAccessCode = process.env.COACH_ACCESS_CODE;
  if (coachAccessCode && safeEqual(normalizeCode(code), normalizeCode(coachAccessCode))) {
    const school = await getOnlySchool();
    if (!school) return { error: "No school is set up yet" };
    await createSession({ schoolId: school._id, meetId: null, role: "coach", name });
    redirect("/meets");
  }

  const hash = hashCode(code);
  const meet = await collection(await getDb(), "meets").findOne({
    deletedAt: null,
    $or: [{ "joinCodes.managerCodeHash": hash }, { "joinCodes.coachCodeHash": hash }],
  });
  if (!meet) return { error: "That code didn't match a meet" };
  const role = meet.joinCodes.coachCodeHash === hash ? "coach" : "manager";
  await createSession({ schoolId: meet.schoolId, meetId: meet._id, role, name });
  redirect(`/meets/${meet._id}`);
}

export async function leaveAction(): Promise<void> {
  await endSession();
  redirect("/join");
}
