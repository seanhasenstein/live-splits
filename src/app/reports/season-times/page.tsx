import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RptPage, RptShell } from "@/components/rpt/rpt";
import { getSession, isSchoolWide } from "@/lib/auth/session";
import { loadSeasonContext, mainDistance } from "@/lib/reports/context";
import { letterStandards } from "@/lib/reports/letters";
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

  // Each meet's varsity letter standard by gender: the split sheet's, else from the whole field.
  const letterMs = await letterStandards(
    ctx.meets.map((m) => m._id),
    ctx.program,
  );

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
