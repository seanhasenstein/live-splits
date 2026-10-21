import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RptPage, RptShell } from "@/components/rpt/rpt";
import { getSession, isSchoolWide } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { loadSeasonContext, mainDistance } from "@/lib/reports/context";
import { type FieldRow, letterStandard } from "@/lib/reports/meet-splits";
import { buildSeasonTimes } from "@/lib/reports/season-times";
import { formatElapsed, formatMonthDayYear } from "@/lib/time";

export const metadata: Metadata = { title: "Season times" };

const GENDERS = [
  { key: "M", label: "Boys" },
  { key: "F", label: "Girls" },
];

/** Season Times (design/report-spec.md §4d): every athlete by every meet, boys then girls, one Letter page each. */
export default async function SeasonTimesPage({ searchParams }: PageProps<"/reports/season-times">) {
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolWide(session)) notFound();
  const { year } = await searchParams;
  const onDate = typeof year === "string" && /^\d{4}$/.test(year) ? `${year}-10-01` : undefined;
  const ctx = await loadSeasonContext(session.schoolId, onDate);
  if (!ctx) notFound();

  // Each meet's varsity letter standard by gender: from the whole field, else the split sheet's.
  const db = await getDb();
  const races = await collection(db, "races").find({ meetId: { $in: ctx.meets.map((m) => m._id) }, deletedAt: null }).toArray();
  const entries = await collection(db, "raceEntries")
    .find({ raceId: { $in: races.filter((r) => r.levelIds.includes("varsity")).map((r) => r._id) }, deletedAt: null }, { projection: { raceId: 1, teamName: 1, place: 1, status: 1, timeMs: 1, athleteId: 1 } })
    .toArray();
  const fields: Record<string, FieldRow[]> = {};
  for (const e of entries) (fields[e.raceId] ??= []).push({ team: e.teamName, place: e.place, status: e.status, timeMs: e.timeMs, ours: !!e.athleteId });
  const categoryGender = new Map(ctx.program.settings.raceCategories.map((c) => [c.id, c.gender]));
  const letterMs: Record<string, Partial<Record<string, number>>> = {};
  for (const r of races) {
    const g = categoryGender.get(r.raceCategoryId) ?? (/\bgirls?\b/i.test(r.name) ? "F" : /\bboys?\b/i.test(r.name) ? "M" : null);
    if (!r.levelIds.includes("varsity") || (g !== "M" && g !== "F")) continue;
    const standard = letterStandard(fields[r._id] ?? [], r.sheetSummary);
    if (standard) (letterMs[r.meetId] ??= {})[g] = standard.ms;
  }

  const season = ctx.history.filter((r) => r.seasonId === ctx.season._id);
  const { columns, byGender } = buildSeasonTimes({
    meets: ctx.meets.map((m) => ({ id: m._id, name: m.name, shortName: m.shortName, date: m.date })),
    athletes: ctx.roster.map((a) => ({ id: a._id, name: a.displayName, gender: a.gender, grade: a.grade })),
    rows: season,
    distanceId: mainDistance(season),
    today: ctx.today,
    letterMs,
  });
  const latest = columns.find((c) => c.latest);
  const latestMeet = latest && ctx.meets.find((m) => m._id === latest.meetId);
  const t = (ms: number) => formatElapsed(Math.floor(ms / 1000) * 1000, "seconds");

  return (
    <RptShell back={{ href: "/reports", label: "Reports" }} title="Season times" subtitle={ctx.season.label}>
      {GENDERS.filter((g) => byGender[g.key]?.length).map((g) => (
        <RptPage
          key={g.key}
          title="Season Times"
          meetLine={
            <div className="hero-meet">
              <span className="mn">{ctx.season.label} Season</span>
              &nbsp;·&nbsp;{latestMeet ? `through the ${latestMeet.name} · ${formatMonthDayYear(latestMeet.date)}` : "no results yet"}
            </div>
          }
          legend={
            <>
              <b style={{ textDecoration: "underline" }}>Underline</b> letter point earned · <b style={{ color: "var(--green)" }}>Bold green</b> season best · blank = did not run
            </>
          }
          right={`Updated ${formatMonthDayYear(ctx.today)}`}
        >
          <div className="sec" style={{ borderBottom: "none" }}>
            {g.label}
          </div>
          <div className="scroll">
            <table className="sgrid">
              <thead>
                <tr>
                  <th className="l">Athlete</th>
                  {columns.map((c) => (
                    <th key={c.meetId} className={c.future ? "ghost" : ""}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byGender[g.key].map((r, i, all) => (
                  <tr key={r.athlete.id} className={(i + 1) % 3 === 0 && i < all.length - 1 ? "g3" : ""}>
                    <td className="name">
                      <Link href={`/athletes/${r.athlete.id}`}>{r.athlete.name}</Link>
                    </td>
                    {r.cells.map((cell, k) => (
                      <td key={columns[k].meetId} className={[cell?.letter ? "let" : "", cell?.best ? "best" : ""].filter(Boolean).join(" ")}>
                        {cell && <span>{t(cell.ms)}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </RptPage>
      ))}
    </RptShell>
  );
}
