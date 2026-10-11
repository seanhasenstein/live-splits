"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { can, getSession, sessionActor } from "@/lib/auth/session";
import { getMeet, getProgram, listRaces } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { Id, type Race } from "@/lib/db/schema";
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
      // One link per line; each may yield one contest (a feed) or many (a meet page).
      const urls = [...new Set(String(formData.get("url") ?? "").split(/\s+/).map((u) => u.trim()).filter(Boolean))];
      if (urls.length === 0) return { error: "Paste a results link." };
      if (urls.length > 10) return { error: "That's a lot of links; ten at a time, please." };
      const contests: ParsedContest[] = [];
      for (const url of urls) {
        try {
          contests.push(...(await fromUrl(url)));
        } catch (err) {
          // Say which link failed when there are several.
          if (urls.length > 1 && err instanceof SourceError) throw new SourceError(`${url}: ${err.message}`);
          throw err;
        }
      }
      return { contests, raw: JSON.stringify(contests), sourceUrl: urls.join(" ") };
    }
    if (kind === "text") {
      const text = String(formData.get("text") ?? "");
      if (!text.trim()) return { error: "Paste the results text." };
      const contest = parseResultsText(text, String(formData.get("name") ?? "Pasted results"));
      if (contest.entries.length === 0) return { error: "No result rows found. Each line should read: place, name, grade, team, times." };
      return { contests: [contest], raw: text, sourceUrl: null };
    }
    // One contest per PDF; several at once for a combined race.
    const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { error: "Choose a PDF." };
    const contests: ParsedContest[] = [];
    for (const file of files) {
      const contest = await fromPdf(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.pdf$/i, ""));
      if (contest.entries.length === 0) return { error: `No result rows found in ${file.name}.` };
      contests.push(contest);
    }
    return { contests, raw: JSON.stringify(contests), sourceUrl: files.map((f) => f.name).join(", ") };
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
  source: z.object({ kind: z.enum(["raceresult", "arrow", "text"]), url: z.string().optional() }),
  precision: z.enum(["seconds", "tenths", "hundredths", "thousandths"]),
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
  const [races, program] = await Promise.all([listRaces(meet._id), getProgram(meet.schoolId, "xc")]);
  const genderOf = (race: Race) => program?.settings.raceCategories.find((c) => c.id === race.raceCategoryId)?.gender ?? null;
  const actor = sessionActor(session!);
  const db = await getDb();

  const plans: ImportPlan[] = [];
  const seenByRace = new Map<string, Set<string>>();
  const lineupAdds = new Map<string, Race["lineup"]>();
  for (const p of payload.plans) {
    const race = races.find((r) => r._id === p.raceId);
    const contest = contests[p.contestIndex];
    if (!race || !contest) return { error: "A race or contest in the import no longer exists." };
    if (!p.assignments.every((a) => contest.entries[a.entryIndex])) return { error: "An assignment points at a results row that doesn't exist." };
    // Only a combined race takes more than one contest (boys + girls).
    const gender = genderOf(race);
    if ((gender === "F" || gender === "M") && plans.some((q) => q.race._id === race._id)) return { error: `${race.name} isn't a combined race, so it can take only one set of results.` };
    // Our runners in the results who weren't on the lineup ran anyway: add them, at their roster level.
    const lineup = new Set(race.lineup.map((l) => l.athleteId));
    const extra = [...new Set(p.assignments.map((a) => a.athleteId))].filter((id) => !lineup.has(id));
    if (extra.length > 0) {
      const roster = await collection(db, "seasonRosters").find({ seasonId: meet.seasonId, athleteId: { $in: extra }, deletedAt: null }).toArray();
      if (roster.length !== extra.length) return { error: "A results row is assigned to someone who isn't on this season's roster." };
      const added = roster.map((r) => ({ athleteId: r.athleteId, levelId: race.levelIds.includes(r.defaultLevelId) ? r.defaultLevelId : race.levelIds[0] }));
      race.lineup = [...race.lineup, ...added];
      added.forEach((l) => lineup.add(l.athleteId));
      lineupAdds.set(race._id, [...(lineupAdds.get(race._id) ?? []), ...added]);
    }
    const seen = seenByRace.get(race._id) ?? new Set<string>();
    seenByRace.set(race._id, seen);
    for (const a of p.assignments) {
      if (seen.has(a.athleteId)) return { error: "An athlete is assigned to two results rows." };
      seen.add(a.athleteId);
    }
    plans.push({ race, contest, assignments: p.assignments, dnsAthleteIds: p.dnsAthleteIds.filter((id) => lineup.has(id) && !seen.has(id)) });
  }

  // Nothing is written until every plan has checked out, and then all of it in one transaction.
  const aliases = payload.plans.flatMap((p) => p.newAliases);
  await commitImport(meet, plans, payload.raw, payload.sourceUrl, actor, { lineupAdds, aliases });
  redirect(`/meets/${meet._id}`);
}
