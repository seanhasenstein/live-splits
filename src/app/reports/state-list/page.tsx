import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RptPage, RptShell } from "@/components/rpt/rpt";
import { getSession, isSchoolWide } from "@/lib/auth/session";
import type { AllTimeRow } from "@/lib/reports/all-time";
import { getStateLists } from "@/lib/reports/all-time-server";
import { loadSeasonContext } from "@/lib/reports/context";
import { formatElapsed, formatMonthDayYear } from "@/lib/time";

export const metadata: Metadata = { title: "State all-time list" };

/** Rows on a page: the first page has the hero; later ones run on. */
const FIRST = 30;
const REST = 37;

/**
 * The State all-time list: every performance our runners ran at the WIAA State meet, fastest first, one
 * list per gender and distance. The top 10 in gold, a line under #30, this season's runs highlighted.
 */
export default async function StateListPage() {
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolWide(session)) notFound();
  const ctx = await loadSeasonContext(session.schoolId);
  if (!ctx) notFound();
  const year = Number(ctx.season.label) || Number(ctx.today.slice(0, 4));
  const lists = await getStateLists(session.schoolId, ctx.program, year);
  const t = (r: AllTimeRow) => r.timeText ?? formatElapsed(r.timeMs, "tenths");
  const legend = (
    <>
      <b style={{ color: "var(--gold)" }}>Gold</b> top 10 · line under the top 30 · <b>Highlighted</b> {year} · ranked to the whole second, ties share a place · older results printed in whole seconds
    </>
  );
  const right = `Updated ${formatMonthDayYear(ctx.today)}`;

  if (lists.length === 0)
    return (
      <RptShell back={{ href: "/reports", label: "Season" }} title="State all-time list">
        <p className="no-print mx-auto max-w-xl px-4 text-sm text-ink-2">No State results yet. A coach loads the history with pnpm db:all-time; this season&apos;s State results join it once they&apos;re in the app.</p>
      </RptShell>
    );

  return (
    <RptShell back={{ href: "/reports", label: "Season" }} title="State all-time list" subtitle={`Through ${year}`}>
      {lists.map((list) => {
        const label = `${list.gender === "M" ? "Boys" : "Girls"} · ${list.meters / 1000}K`;
        const pages: AllTimeRow[][] = [list.rows.slice(0, FIRST)];
        for (let k = FIRST; k < list.rows.length; k += REST) pages.push(list.rows.slice(k, k + REST));
        const years = list.rows.map((r) => r.year);
        return pages.map((rows, n) => (
          <RptPage
            key={`${label}-${n}`}
            title={n === 0 ? "State All-Time List" : null}
            meetLine={
              n === 0 ? (
                <div className="hero-meet">
                  <span className="mn">WIAA State Cross Country</span>
                  &nbsp;·&nbsp;{label} · {list.rows.length} performances, {Math.min(...years)}–{Math.max(...years)}
                </div>
              ) : undefined
            }
            legend={legend}
            right={right}
          >
            {n === 0 && <div className="sec">{label}</div>}
            <table className="sp atl" style={{ tableLayout: "fixed" }}>
              <colgroup>
                {[9, 41, 11, 9, 16, 14].map((w, k) => (
                  <col key={k} style={{ width: `${w}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="l">Rank</th>
                  <th className="l">Athlete</th>
                  <th>Year</th>
                  <th>Gr</th>
                  <th>Time</th>
                  <th>Place</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const next = rows[i + 1] ?? (pages[n + 1]?.[0] ?? null);
                  const lastOfTop30 = r.rank <= 30 && (!next || next.rank > 30);
                  return (
                    <tr key={`${r.name}-${r.year}-${r.timeMs}`} className={[r.current ? "cur" : "", lastOfTop30 ? "top30" : ""].join(" ").trim()}>
                      <td className={`l rk ${r.rank <= 10 ? "gold" : ""}`}>{r.rank}</td>
                      <td className="name">{r.athleteId ? <Link href={`/athletes/${r.athleteId}`}>{r.name}</Link> : r.name}</td>
                      <td>{r.year}</td>
                      <td>{r.grade ?? ""}</td>
                      <td className="fin">{t(r)}</td>
                      <td className="plc">{r.place ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </RptPage>
        ));
      })}
    </RptShell>
  );
}
