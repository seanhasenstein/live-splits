import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AthleteRacesTable, KpiStrip } from "@/components/report/athlete-races";
import { ReportShell, Sheet, SheetSection, teamBrand } from "@/components/report/report";
import { TimeChart } from "@/components/report/time-chart";
import { getSession, isSchoolWide } from "@/lib/auth/session";
import { getProgram, getSchool } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { gradeForSeason } from "@/lib/grade";
import { METERS_PER_MILE } from "@/lib/pace";
import { mainDistance } from "@/lib/reports/context";
import { summarizeAthlete } from "@/lib/reports/athlete";
import { getTeamHistory } from "@/lib/reports/history";
import { formatDateWithYear, formatElapsed } from "@/lib/time";

export const metadata: Metadata = { title: "Athlete" };

/** An athlete's whole career at the main distance: every race by season, with bests, splits, places and a chart. */
export default async function AthletePage({ params }: PageProps<"/athletes/[athleteId]">) {
  const { athleteId } = await params;
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolWide(session)) notFound();
  const db = await getDb();
  const athlete = await collection(db, "athletes").findOne({ _id: athleteId, schoolId: session.schoolId, deletedAt: null });
  if (!athlete) notFound();
  const [school, program] = await Promise.all([getSchool(session.schoolId), getProgram(session.schoolId, "xc")]);
  if (!school || !program) notFound();
  const [everyone, seasons] = await Promise.all([
    collection(db, "athletes").find({ schoolId: session.schoolId, deletedAt: null }, { projection: { _id: 1 } }).toArray(),
    collection(db, "seasons").find({ programId: program._id, deletedAt: null }).toArray(),
  ]);
  // Everyone's history, for team places in each race.
  const history = await getTeamHistory(session.schoolId, program, everyone.map((a) => a._id));
  const mine = history.filter((r) => r.athleteId === athlete._id);
  const distanceId = mainDistance(mine);
  const seasonById = new Map(seasons.map((s) => [s._id, s]));
  // Newest season first.
  const seasonIds = [...new Set(mine.filter((r) => r.distanceId === distanceId).map((r) => r.seasonId))].sort((a, b) => (seasonById.get(b)?.startDate ?? "").localeCompare(seasonById.get(a)?.startDate ?? ""));
  const career = summarizeAthlete({ athleteId: athlete._id, rows: history, teamRows: history, distanceId, seasonId: seasonIds[0] ?? "", courseId: null });
  const t = (ms: number | null | undefined) => (ms == null ? "—" : formatElapsed(ms, "seconds"));
  const splitLabels = [
    { label: "Mile 1", meters: METERS_PER_MILE },
    { label: "Mile 2", meters: 2 * METERS_PER_MILE },
  ];
  const finished = career.races.filter((r) => r.finishMs !== null);
  const latestSeason = seasonIds[0] ? seasonById.get(seasonIds[0]) : undefined;
  const grade = athlete.graduationYear !== null && latestSeason ? gradeForSeason(athlete.graduationYear, latestSeason.endDate) : null;

  return (
    <ReportShell back={{ href: "/reports", label: "Reports" }} title={athlete.displayName} subtitle="Career">
      <Sheet
        team={teamBrand(school)}
        header={{
          kicker: (
            <>
              Career · <span className="text-[var(--r-gold-text)]">{school.shortName} Cross Country</span>
            </>
          ),
          title: athlete.displayName,
          subline: (
            <>
              {athlete.graduationYear !== null && <span className="font-semibold text-[var(--r-ink)]">Class of {athlete.graduationYear}</span>}
              {grade !== null && grade <= 12 ? ` · Grade ${grade}` : ""}
              {` · ${finished.length} race${finished.length === 1 ? "" : "s"} over ${seasonIds.length} season${seasonIds.length === 1 ? "" : "s"}`}
            </>
          ),
        }}
        legend={
          <>
            Every race on file at the main distance. <span className="font-semibold text-[var(--r-green-text)]">Green row</span>: career best. <span className="font-semibold text-[var(--r-gold-text)]">Gold row</span>: that season&apos;s best. Splits are
            each mile on its own. Team: place among our runners in that race. Vs prev: against the race before.
          </>
        }
        tag={`Updated ${formatDateWithYear(new Date().toISOString().slice(0, 10))}`}
      >
        <KpiStrip
          items={[
            { label: "Career best", value: t(career.careerBest?.finishMs), note: career.careerBest?.label, tone: "green" },
            { label: latestSeason ? `${latestSeason.label} best` : "Season best", value: t(career.seasonBest?.finishMs), note: career.seasonBest?.label, tone: "gold" },
            { label: "Last race", value: t(career.lastRace?.finishMs), note: career.lastRace?.label },
            { label: "Races", value: String(finished.length), note: `${seasonIds.length} season${seasonIds.length === 1 ? "" : "s"}` },
          ]}
        />
        {seasonIds.map((sid) => {
          const s = summarizeAthlete({ athleteId: athlete._id, rows: history, teamRows: history, distanceId, seasonId: sid, courseId: null });
          // PR marks come from the whole career; SB from this season.
          const races = s.season.map((r) => ({ ...r, pr: r.raceId === career.careerBest?.raceId }));
          const season = seasonById.get(sid);
          const g = athlete.graduationYear !== null && season ? gradeForSeason(athlete.graduationYear, season.endDate) : null;
          const timed = races.filter((r) => r.finishMs !== null);
          return (
            <SheetSection
              key={sid}
              title={
                <>
                  {season?.label ?? "Season"}
                  {g !== null && g <= 12 ? ` · Grade ${g}` : ""}
                </>
              }
              aside={s.seasonBest ? `Season best ${t(s.seasonBest.finishMs)} · ${timed.length} race${timed.length === 1 ? "" : "s"}` : undefined}
            >
              <AthleteRacesTable races={races} splitLabels={splitLabels} finishMeters={5000} />
              {timed.length >= 3 && (
                <div className="mt-2">
                  <TimeChart height={140} points={timed.map((r) => ({ label: r.label.slice(4), sub: r.levelId === "jv" ? "JV" : undefined, ms: r.finishMs!, mark: r.pr ? "best" : r.sb ? "gold" : undefined }))} />
                </div>
              )}
            </SheetSection>
          );
        })}
        {seasonIds.length === 0 && <p className="text-[11px] text-[var(--r-ink-2)]">No races on file yet.</p>}
      </Sheet>
    </ReportShell>
  );
}

