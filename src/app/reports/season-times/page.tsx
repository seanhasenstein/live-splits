import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MajorHeading, ReportShell, Sheet, TableWrap, td, teamBrand, th } from "@/components/report/report";
import { getSession, isSchoolWide } from "@/lib/auth/session";
import { loadSeasonContext, mainDistance } from "@/lib/reports/context";
import { buildSeasonTimes } from "@/lib/reports/season-times";
import { formatElapsed, formatLocalDateLong } from "@/lib/time";

export const metadata: Metadata = { title: "Season times" };

const GENDERS = [
  { key: "M", label: "Boys" },
  { key: "F", label: "Girls" },
];

/** Season Times: every athlete by every meet, boys then girls, one Letter page each. */
export default async function SeasonTimesPage({ searchParams }: PageProps<"/reports/season-times">) {
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolWide(session)) notFound();
  const { year } = await searchParams;
  const onDate = typeof year === "string" && /^\d{4}$/.test(year) ? `${year}-10-01` : undefined;
  const ctx = await loadSeasonContext(session.schoolId, onDate);
  if (!ctx) notFound();

  const season = ctx.history.filter((r) => r.seasonId === ctx.season._id);
  const { columns, byGender } = buildSeasonTimes({
    meets: ctx.meets.map((m) => ({ id: m._id, name: m.name, shortName: m.shortName, date: m.date })),
    athletes: ctx.roster.map((a) => ({ id: a._id, name: a.displayName, gender: a.gender, grade: a.grade })),
    rows: season,
    distanceId: mainDistance(season),
    today: ctx.today,
  });
  const latest = columns.find((c) => c.latest);
  const latestMeet = latest && ctx.meets.find((m) => m._id === latest.meetId);
  const team = teamBrand(ctx.school);
  const t = (ms: number) => formatElapsed(ms, "seconds");
  const updated = formatLocalDateLong(ctx.today).replace(/^[A-Za-z]+, /, "");

  return (
    <ReportShell back={{ href: "/reports", label: "Reports" }} title="Season times" subtitle={ctx.season.label}>
      {GENDERS.filter((g) => byGender[g.key]?.length).map((g) => (
        <Sheet
          key={g.key}
          team={team}
          header={{
            title: "Season Times",
            subline: (
              <>
                <span className="font-semibold text-[var(--r-ink)]">{ctx.season.label} Season</span>
                {latestMeet ? ` · through the ${latestMeet.name} · ${formatLocalDateLong(latestMeet.date).replace(/^[A-Za-z]+, /, "")}` : " · no results yet"}
              </>
            ),
          }}
          legend={
            <>
              <span className="font-bold text-[var(--r-green)]">Bold green</span> season best · <sup>JV</sup> ran the JV race · blank = did not run · gray columns are still to come · times truncated to whole seconds
            </>
          }
          tag={`Updated ${updated}`}
        >
          <MajorHeading>{g.label}</MajorHeading>
          <TableWrap>
            <table className="report-grouped w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Athlete</th>
                  {columns.map((c) => (
                    <th key={c.meetId} className={`${th} text-center ${c.future ? "text-[var(--r-ink-3)]!" : c.latest ? "text-[var(--r-ink)]!" : ""}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byGender[g.key].map((r) => (
                  <tr key={r.athlete.id}>
                    <td className={`${td} pr-3 font-semibold`}>
                      <Link href={`/athletes/${r.athlete.id}`} className="hover:underline">
                        {r.athlete.name}
                      </Link>
                    </td>
                    {r.cells.map((cell, i) => (
                      <td key={columns[i].meetId} className={`${td} text-center ${columns[i].latest ? "font-semibold" : ""}`}>
                        {cell && (
                          <span className={cell.best ? "font-bold text-[var(--r-green)]" : ""}>
                            {t(cell.ms)}
                            {cell.jv && <sup className="ml-px text-[6.5px] font-semibold text-[var(--r-ink-3)]">JV</sup>}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Sheet>
      ))}
    </ReportShell>
  );
}

