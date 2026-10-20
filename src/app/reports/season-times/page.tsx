import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReportShell, Sheet, td, teamBrand, th } from "@/components/report/report";
import { getSession, isSchoolWide } from "@/lib/auth/session";
import { loadSeasonContext, mainDistance } from "@/lib/reports/context";
import { buildSeasonTimes } from "@/lib/reports/season-times";
import { formatDateWithYear, formatElapsed } from "@/lib/time";

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
    meets: ctx.meets.map((m) => ({ id: m._id, name: m.name, date: m.date })),
    athletes: ctx.roster.map((a) => ({ id: a._id, name: a.displayName, gender: a.gender, grade: a.grade })),
    rows: season,
    distanceId: mainDistance(season),
    today: ctx.today,
  });
  const latest = columns.find((c) => c.latest);
  const latestMeet = latest && ctx.meets.find((m) => m._id === latest.meetId);
  const team = teamBrand(ctx.school);
  const t = (ms: number) => formatElapsed(ms, "seconds");
  const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

  return (
    <ReportShell back={{ href: "/reports", label: "Reports" }} title="Season times" subtitle={ctx.season.label}>
      {GENDERS.filter((g) => byGender[g.key]?.length).map((g) => (
        <Sheet
          key={g.key}
          team={team}
          header={{
            title: `Season Times · ${g.label}`,
            subline: (
              <>
                <span className="font-semibold text-[var(--r-ink)]">{ctx.season.label} season</span>
                {latestMeet ? ` · through the ${latestMeet.name}` : " · no results yet"}
              </>
            ),
          }}
          legend={
            <>
              <span className="font-semibold text-[var(--r-green-text)]">Bold green</span>: season best. <span className="text-[var(--r-ink-3)]">Gray columns</span>: meets still to come. <sup>JV</sup>: ran the JV race. Times are
              the team&apos;s official finishes, in whole seconds.
            </>
          }
          tag={`Updated ${formatDateWithYear(ctx.today)}`}
        >
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Athlete</th>
                {columns.map((c) => (
                  <th key={c.meetId} className={`${th} text-center ${c.future ? "text-[var(--r-ink-3)]" : ""}`}>
                    <span className={`block normal-case ${c.latest ? "text-[var(--r-ink)]" : ""}`} style={{ letterSpacing: 0 }}>
                      {c.label}
                    </span>
                    <span className="block font-medium">{md(c.date)}</span>
                  </th>
                ))}
                <th className={`${th} text-right`}>Best</th>
              </tr>
            </thead>
            <tbody>
              {byGender[g.key].map((r) => (
                <tr key={r.athlete.id}>
                  <td className={`${td} pr-2 font-medium`}>
                    <Link href={`/athletes/${r.athlete.id}`} className="hover:underline">
                      {r.athlete.name}
                    </Link>
                    {r.athlete.grade !== null && <span className="ml-1 text-[8.5px] text-[var(--r-ink-3)]">{r.athlete.grade}</span>}
                  </td>
                  {r.cells.map((cell, i) => (
                    <td key={columns[i].meetId} className={`${td} text-center ${columns[i].future ? "bg-[#f7f7f4]" : ""} ${columns[i].latest ? "font-semibold" : ""}`}>
                      {cell && (
                        <span className={cell.best ? "font-bold text-[var(--r-green-text)]" : ""}>
                          {t(cell.ms)}
                          {cell.jv && <sup className="ml-px text-[6.5px] font-semibold text-[var(--r-ink-3)]">JV</sup>}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className={`${td} text-right font-bold text-[var(--r-green-text)]`}>{r.bestMs !== null ? t(r.bestMs) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Sheet>
      ))}
    </ReportShell>
  );
}
