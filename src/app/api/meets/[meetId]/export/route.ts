import { can, getSession } from "@/lib/auth/session";
import { getMeet, getProgram, getRace, listAthletes } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { buildExportRows, toCsv } from "@/lib/export";
import { gradeForSeason } from "@/lib/grade";
import { getRaceStateWithStatuses } from "@/lib/race-state";
import { getOfficialTimes } from "@/lib/results/import";

/** `?race=<id>` → CSV of that race in the split-workbook layout. Coaches only. */
export async function GET(request: Request, { params }: RouteContext<"/api/meets/[meetId]/export">) {
  const { meetId } = await params;
  const raceId = new URL(request.url).searchParams.get("race") ?? "";
  const session = await getSession();
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "view", meet)) return new Response("Not found", { status: 404 });
  if (!can(session, "export", meet)) return new Response("Coaches only", { status: 403 });
  const race = await getRace(raceId);
  if (!race || race.meetId !== meet._id) return new Response("Race not found", { status: 404 });

  const db = await getDb();
  const [program, season, { state, statuses }, official, athletes] = await Promise.all([
    getProgram(meet.schoolId, "xc"),
    collection(db, "seasons").findOne({ _id: meet.seasonId }),
    getRaceStateWithStatuses(race),
    getOfficialTimes(race),
    listAthletes(
      meet.schoolId,
      race.lineup.map((l) => l.athleteId),
    ),
  ]);
  const levelById = new Map(race.lineup.map((l) => [l.athleteId, l.levelId]));
  const levelLabel = (id: string) => program?.settings.levels.find((l) => l.id === id)?.label ?? id;

  const rows = buildExportRows({
    race,
    state,
    statuses,
    official,
    levelLabel,
    athletes: athletes.map((a) => ({
      _id: a._id,
      displayName: a.displayName,
      graduationYear: a.graduationYear,
      levelId: levelById.get(a._id) ?? race.levelIds[0],
      grade: a.graduationYear !== null && season ? gradeForSeason(a.graduationYear, season.endDate) : null,
    })),
  });

  const [y, m, d] = meet.date.split("-");
  const title = `${race.name} · ${meet.name} · ${Number(m)}/${Number(d)}/${y.slice(2)}`;
  const hasOfficial = Object.keys(official).length > 0;
  const note = hasOfficial
    ? "Place, Official Finish and mat mile times from the imported official results; other mile times from the app (m:ss, truncated). Flag columns: official, estimate, edited, missed."
    : race.gunTimeMs
      ? "Cumulative times from the app (m:ss, truncated). Place and Official Finish come from the official results. Flag columns: estimate, edited, missed."
      : "No gun time was set for this race, so times are blank. Set the gun time and export again.";
  const csv = toCsv([[title], [note], [], ...rows]);
  const fileName = `${meet.date}-${meet.name}-${race.name}.csv`.replace(/[^\w.-]+/g, "-").toLowerCase();

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
