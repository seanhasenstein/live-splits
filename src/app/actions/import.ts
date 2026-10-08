"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { can, getSession, sessionActor } from "@/lib/auth/session";
import { getMeet, listRaces } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { Id } from "@/lib/db/schema";
import { commitImport, type ImportPlan } from "@/lib/results/import";
import type { ParsedContest } from "@/lib/results/parse";
import { parseResultsText } from "@/lib/results/parse";
import { fromPdf, fromUrl, SourceError } from "@/lib/results/sources";

export type LoadState = { error?: string; contests?: ParsedContest[]; raw?: string; sourceUrl?: string | null };

/** Step 1: turn a link, pasted text or a PDF into contests for the coach to map. */
export async function loadResultsAction(meetId: string, _prev: LoadState, formData: FormData): Promise<LoadState> {
  const session = await getSession();
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "export", meet)) return { error: "Not allowed" };

  const kind = String(formData.get("kind") ?? "url");
  try {
    if (kind === "url") {
      const url = String(formData.get("url") ?? "").trim();
      if (!url) return { error: "Paste a results link." };
      const contests = await fromUrl(url);
      return { contests, raw: JSON.stringify(contests), sourceUrl: url };
    }
    if (kind === "text") {
      const text = String(formData.get("text") ?? "");
      if (!text.trim()) return { error: "Paste the results text." };
      const contest = parseResultsText(text, String(formData.get("name") ?? "Pasted results"));
      if (contest.entries.length === 0) return { error: "No result rows found. Each line should read: place, name, grade, team, times." };
      return { contests: [contest], raw: text, sourceUrl: null };
    }
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF." };
    const contest = await fromPdf(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.pdf$/i, ""));
    if (contest.entries.length === 0) return { error: "No result rows found in that PDF." };
    return { contests: [contest], raw: JSON.stringify(contest), sourceUrl: file.name };
  } catch (err) {
    if (err instanceof SourceError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Couldn't read those results." };
  }
}

const ParsedContestSchema = z.object({
  name: z.string().min(1).max(200),
  distanceMeters: z.number().nullable(),
  splitLabels: z.array(z.string()),
  entries: z.array(
    z.object({
      firstName: z.string(),
      lastName: z.string(),
      name: z.string().min(1),
      team: z.string().nullable(),
      grade: z.int().nullable(),
      bib: z.string().nullable(),
      place: z.int().positive().nullable(),
      status: z.enum(["finished", "dnf", "dns", "dq"]),
      finishMs: z.int().nonnegative().nullable(),
      splits: z.record(z.string(), z.int().nonnegative()),
    }),
  ),
  source: z.object({ kind: z.enum(["raceresult", "text"]), url: z.string().optional() }),
});

const CommitPayload = z.object({
  raw: z.string(),
  sourceUrl: z.string().nullable(),
  contests: z.array(ParsedContestSchema),
  plans: z.array(
    z.object({
      raceId: Id,
      contestIndex: z.int().nonnegative(),
      assignments: z.array(z.object({ entryIndex: z.int().nonnegative(), athleteId: Id })),
      dnsAthleteIds: z.array(Id),
      /** Spellings the coach confirmed; remembered on the athlete for next time. */
      newAliases: z.array(z.object({ athleteId: Id, alias: z.string().min(1) })),
    }),
  ),
});
export type CommitPayload = z.infer<typeof CommitPayload>;

/** Step 2: write the mapped contests. */
export async function commitImportAction(meetId: string, payloadJson: string): Promise<{ error?: string }> {
  const session = await getSession();
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "export", meet)) return { error: "Not allowed" };
  let json: unknown;
  try {
    json = JSON.parse(payloadJson);
  } catch {
    return { error: "Invalid import" };
  }
  const parsed = CommitPayload.safeParse(json);
  if (!parsed.success) return { error: "Invalid import" };
  const payload = parsed.data;
  const contests = payload.contests as ParsedContest[];
  const races = await listRaces(meet._id);

  const plans: ImportPlan[] = [];
  const seenByRace = new Map<string, Set<string>>();
  for (const p of payload.plans) {
    const race = races.find((r) => r._id === p.raceId);
    const contest = contests[p.contestIndex];
    if (!race || !contest) return { error: "A race or contest in the import no longer exists." };
    const lineup = new Set(race.lineup.map((l) => l.athleteId));
    if (!p.assignments.every((a) => lineup.has(a.athleteId) && contest.entries[a.entryIndex])) return { error: "An assignment points outside the race lineup." };
    const seen = seenByRace.get(race._id) ?? new Set<string>();
    seenByRace.set(race._id, seen);
    for (const a of p.assignments) {
      if (seen.has(a.athleteId)) return { error: "An athlete is assigned to two results rows." };
      seen.add(a.athleteId);
    }
    plans.push({ race, contest, assignments: p.assignments, dnsAthleteIds: p.dnsAthleteIds.filter((id) => lineup.has(id) && !seen.has(id)) });
  }

  const actor = sessionActor(session!);
  const db = await getDb();
  for (const p of payload.plans) {
    for (const { athleteId, alias } of p.newAliases) {
      await collection(db, "athletes").updateOne({ _id: athleteId, schoolId: meet.schoolId }, { $addToSet: { aliases: alias }, $set: { updatedAt: new Date(), updatedBy: actor } });
    }
  }
  await commitImport(meet, plans, payload.raw, payload.sourceUrl, actor);
  redirect(`/meets/${meet._id}`);
}
