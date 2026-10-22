"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { displayCase } from "@/lib/names";
import { fieldScores, ordinal, type OurTeam } from "@/lib/race-places";
import type { FieldEntry } from "@/lib/results/import";
import { formatElapsed } from "@/lib/time";

/** How long a runner who just posted stays highlighted. */
const FRESH_MS = 8000;


/**
 * The whole race as the timing company posts it, every team (the board's Everyone view): team scores
 * for every team, provisional while the race runs (a team scores once five of its runners are in), and
 * every finisher in place order, ours marked and the newest lit up as they post.
 */
export function FieldView({ field, ourTeam, live, mixed }: { field: FieldEntry[]; ourTeam: OurTeam; live: boolean; mixed: boolean }) {
  // Tenths for everyone when the timing company gives any (a 16:42.0 shouldn't read as 16:42 beside 16:42.4).
  const tenths = field.some((e) => e.timeMs != null && e.timeMs % 1000 !== 0);
  const time = (ms: number | null | undefined) => (ms == null ? "" : formatElapsed(ms, tenths ? "tenths" : "seconds"));
  const finished = useMemo(() => field.filter((e) => e.status === "finished" && e.place !== null).sort((a, b) => a.place! - b.place!), [field]);
  const out = useMemo(() => field.filter((e) => e.status !== "finished" || e.place === null), [field]);
  const { scores, names } = useMemo(() => fieldScores(field), [field]);
  const teamName = (key: string) => (key === "us" ? ourTeam.name : (names.get(key) ?? key));
  const scoring = scores.filter((s) => s.points !== null);
  const notYet = scores.filter((s) => s.points === null);
  const teams = useMemo(() => [...new Set(field.map((e) => e.team).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b)), [field]);
  const [team, setTeam] = useState("");

  // Newest finishers light up for a few seconds: the ones that weren't there on the last update.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const keyOf = (e: FieldEntry) => `${e.place}|${e.name}|${e.team}`;
  useEffect(() => {
    const keys = finished.map(keyOf);
    // The first load isn't news: only runners who post while you watch light up.
    const added = seen.current === null ? [] : keys.filter((k) => !seen.current!.has(k));
    seen.current = new Set(keys);
    if (added.length === 0) return;
    // Not cleared when the next poll re-runs this (every few seconds): only on unmount, below.
    timers.current.push(
      setTimeout(() => setFresh((f) => new Set([...f, ...added])), 0),
      setTimeout(() => setFresh((f) => new Set([...f].filter((k) => !added.includes(k)))), FRESH_MS),
    );
  }, [finished]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const isFresh = (e: FieldEntry) => fresh.has(keyOf(e));

  const shown = team ? finished.filter((e) => e.team === team) : finished;
  if (field.length === 0)
    return (
      <Card>
        <p className="px-4 py-8 text-center text-sm text-ink-2">{live ? "Waiting for the first finishers from the timing company…" : "No results from the timing company yet."}</p>
      </Card>
    );

  return (
    <div className="space-y-3">
      {!mixed && (
        <Card className="overflow-hidden">
          <CardHeader
            title={live ? "Team scores · provisional" : "Team scores"}
            description={live ? "Every team, from the runners in so far. A team scores once five of its runners finish; 6th and 7th push others back." : "Every team, five to score; 6th and 7th push others back."}
          />
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
                  <th className="py-2 pr-2 pl-3 font-semibold sm:pl-4">Pl</th>
                  <th className="py-2 pr-2 font-semibold">Team</th>
                  <th className="py-2 pr-2 text-right font-semibold">Pts</th>
                  <th className="py-2 pr-3 font-semibold max-sm:hidden sm:pr-4">1–5 (6, 7)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {scoring.map((s, i) => (
                  <tr key={s.team} className={s.team === "us" ? "bg-brand-soft/60 font-semibold text-brand-text" : ""}>
                    <td className="py-2 pr-2 pl-3 sm:pl-4">{i + 1}</td>
                    <td className="py-2 pr-2">
                      {teamName(s.team)}
                      <span className="block text-xs font-normal text-ink-3 sm:hidden">
                        {s.places.slice(0, 5).join(" · ")}
                        {s.places.length > 5 && ` (${s.places.slice(5).join(", ")})`}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right font-semibold">{s.points}</td>
                    <td className="py-2 pr-3 text-ink-2 max-sm:hidden sm:pr-4">
                      {s.places.slice(0, 5).join(" · ")}
                      {s.places.length > 5 && <span className="text-ink-3"> ({s.places.slice(5).join(", ")})</span>}
                    </td>
                  </tr>
                ))}
                {scoring.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-ink-3">
                      No team has five runners in yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {notYet.length > 0 && (
            <p className="border-t border-line px-4 py-2.5 text-[13px] text-ink-2">
              <span className="font-medium text-ink">{live ? "Not five in yet" : "No team score"}:</span> {notYet.map((s) => `${teamName(s.team)} (${s.runners})`).join(", ")}
            </p>
          )}
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader
          title={`${finished.length} finished`}
          description={mixed ? "Boys and girls together here, so no team scores." : undefined}
          action={
            teams.length > 1 ? (
              <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Show one team" className="h-8 max-w-48 rounded-md border border-line bg-surface px-2 text-[13px] text-ink">
                <option value="">All teams</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : undefined
          }
        />
        <table className="w-full border-t border-line text-sm tabular-nums">
          <tbody className="divide-y divide-line">
            {shown.map((e) => (
              <tr key={keyOf(e)} className={`transition-colors duration-1000 ${isFresh(e) ? "bg-gold-soft" : e.ours ? "bg-brand-soft/60" : ""}`}>
                <td className="w-12 py-2 pr-2 pl-3 text-right text-ink-2 sm:pl-4">{ordinal(e.place!)}</td>
                <td className="py-2 pr-2">
                  <span className={`font-medium ${e.ours ? "text-brand-text" : "text-ink"}`}>{displayCase(e.name ?? "")}</span>
                  {e.grade != null && e.grade <= 12 && <span className="ml-1.5 text-xs text-ink-3">{e.grade}</span>}
                  <span className="block truncate text-xs text-ink-2">{e.team ?? "Unattached"}</span>
                </td>
                <td className="py-2 pr-3 text-right font-semibold text-ink sm:pr-4">{time(e.timeMs)}</td>
              </tr>
            ))}
            {out
              .filter((e) => !team || e.team === team)
              .map((e) => (
                <tr key={`out|${e.name}|${e.team}`} className="text-ink-3">
                  <td className="py-2 pr-2 pl-3 text-right sm:pl-4">—</td>
                  <td className="py-2 pr-2">
                    {displayCase(e.name ?? "")}
                    <span className="block text-xs">{e.team ?? "Unattached"}</span>
                  </td>
                  <td className="py-2 pr-3 text-right text-xs font-semibold uppercase sm:pr-4">{e.status}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
