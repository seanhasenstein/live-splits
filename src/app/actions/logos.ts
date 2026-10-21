"use server";

import { revalidatePath } from "next/cache";
import { getSession, isSchoolCoach, sessionActor } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { saveLogo } from "@/lib/logos-server";

export type LogoState = { error?: string; saved?: string };

const MAX_BYTES = 4 * 1024 * 1024;

/** Adds or replaces a team's logo from an uploaded image. School coaches only. */
export async function uploadLogo(_prev: LogoState, form: FormData): Promise<LogoState> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return { error: "Only a coach can change logos." };
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const file = form.get("file");
  if (!name) return { error: "Enter the team's name." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image." };
  if (file.size > MAX_BYTES) return { error: "That image is over 4 MB. Try a smaller one." };
  if (!file.type.startsWith("image/")) return { error: "That file isn't an image (PNG, JPG, WebP or SVG)." };
  try {
    await saveLogo(session!.schoolId, name, Buffer.from(await file.arrayBuffer()), sessionActor(session!));
  } catch {
    return { error: "That image couldn't be read. Try a PNG or JPG." };
  }
  revalidatePath("/reports/logos");
  return { saved: name };
}

/** Removes a team's logo (it goes back to initials). */
export async function removeLogo(form: FormData): Promise<void> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return;
  const key = String(form.get("key") ?? "");
  await collection(await getDb(), "teamLogos").updateOne({ schoolId: session!.schoolId, key }, { $set: { deletedAt: new Date(), updatedAt: new Date(), updatedBy: sessionActor(session!) } });
  revalidatePath("/reports/logos");
}
