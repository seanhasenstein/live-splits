"use server";

import { z } from "zod";
import { getSession, isSchoolCoach, sessionActor } from "@/lib/auth/session";
import { getProgram, getSchool } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { commitHistory, type HistoryCommitResult, type HistoryReview, reviewHistory } from "@/lib/results/history-import";
import { type HistoryMeet, parseSplitsHistory } from "@/lib/results/splits-history";
import { fromPdfText } from "@/lib/results/sources";

export type HistoryLoadState = { error?: string; meets?: HistoryMeet[]; review?: HistoryReview };

/** Step 1: read the split-sheet PDF and say what's in it. */
export async function loadHistoryAction(_prev: HistoryLoadState, formData: FormData): Promise<HistoryLoadState> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return { error: "Only a coach session can import history" };
  const school = await getSchool(session!.schoolId);
  if (!school) return { error: "No school" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the split sheets PDF." };
  try {
    const text = await fromPdfText(new Uint8Array(await file.arrayBuffer()));
    const meets = parseSplitsHistory(text);
    if (meets.length === 0) return { error: "No meets found. The sheet needs a 'Meet name, Month Dth YYYY' line per meet and a table per gender with Mile 1 … Finish, Place." };
    return { meets, review: await reviewHistory(await getDb(), school, meets) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't read that PDF." };
  }
}

const RowSchema = z.object({
  name: z.string().min(1),
  gender: z.enum(["M", "F"]),
  level: z.enum(["varsity", "jv"]),
  splits: z.record(z.string(), z.int().nonnegative()),
  finishMs: z.int().nonnegative().nullable(),
  place: z.int().positive().nullable(),
  status: z.enum(["finished", "dnf"]),
  letter: z.boolean(),
});
const MeetSchema = z.object({
  name: z.string().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkpoints: z.array(z.object({ label: z.string().min(1), meters: z.number().positive() })),
  distanceMeters: z.number().positive().nullable(),
  rows: z.array(RowSchema),
  summaries: z.array(z.string()),
});
const Payload = z.object({
  meets: z.array(MeetSchema).max(400),
  choices: z.object({
    meets: z.record(z.string(), z.object({ venueName: z.string().max(120) })),
    athletes: z.record(z.string(), z.union([z.object({ athleteId: z.string().min(1) }), z.object({ create: z.object({ graduationYear: z.int().min(1990).max(2100).nullable() }) })])),
  }),
});

/** Step 2: write the chosen meets. */
export async function commitHistoryAction(payloadJson: string): Promise<{ error?: string; result?: HistoryCommitResult }> {
  const session = await getSession();
  if (!isSchoolCoach(session)) return { error: "Only a coach session can import history" };
  const school = await getSchool(session!.schoolId);
  const program = school && (await getProgram(school._id, "xc"));
  if (!school || !program) return { error: "No XC program is set up" };
  let json: unknown;
  try {
    json = JSON.parse(payloadJson);
  } catch {
    return { error: "Invalid import" };
  }
  const parsed = Payload.safeParse(json);
  if (!parsed.success) return { error: `Invalid import: ${parsed.error.issues[0]?.message ?? ""}` };
  const choices = { meets: Object.fromEntries(Object.entries(parsed.data.choices.meets).map(([k, v]) => [Number(k), v])), athletes: parsed.data.choices.athletes };
  try {
    const result = await commitHistory(school, program, parsed.data.meets, choices, sessionActor(session!));
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The import failed; nothing was written." };
  }
}
