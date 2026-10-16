"use client";

import { useState } from "react";
import { Card, Segmented } from "@/components/ui";
import type { RacePlaces } from "@/lib/db/schema";
import { awardStatus, type CheckpointPlaces, ordinal, type OurTeam, placeColor, type TeamScore, trackedTeamFor } from "@/lib/race-places";

type View = { id: string; label: string };

/**
 * Places on Live results: for a checkpoint where someone counted, the head-to-head score
 * with the tracked teams, a guess at the whole meet when everyone was counted, and where our
 * runners stand against the award lines. At the finish, real team scores from the timing
 * company's results once they post.
 */
export function PlacesCard({
  config,
  checkpoints,
  places,
  official,
  ourTeam,
  athletes,
}: {
  config: RacePlaces;
  checkpoints: { id: string; label: string }[];
  places: Map<string, CheckpointPlaces>;
  /** Team scores from the official results (every team), and our runners' official places. */
  official: { scores: TeamScore[]; names: Map<string, string>; place: Map<string, number> } | null;
  ourTeam: OurTeam;
  athletes: Record<string, string>;
}) {
  const views: View[] = [...checkpoints.filter((c) => places.has(c.id)), ...(official && official.scores.length > 0 ? [{ id: "official", label: "Official" }] : [])];
  const [picked, setPicked] = useState<string | null>(null);
  if (views.length === 0) return null;
  // Follow the race: the latest checkpoint with places, until someone picks one.
  const viewId = picked && views.some((v) => v.id === picked) ? picked : views.at(-1)!.id;

  const tracked = new Map(config.teams.map((t) => [t.id, t]));
  const teamChip = (key: string, name?: string) => {
    const t = tracked.get(key);
    if (key === "us") return <span className="rounded bg-brand px-1.5 py-0.5 text-xs font-bold text-brand-ink">{ourTeam.short}</span>;
    if (t) {
      const c = placeColor(t.color);
      return (
        <span className="rounded px-1.5 py-0.5 text-xs font-bold" style={{ background: c.bg, color: c.ink }}>
          {t.short}
        </span>
      );
    }
    return <span className="text-[13px] text-ink">{name ?? key}</span>;
  };
  const scoreRows = (scores: TeamScore[], opts: { approx?: boolean; names?: Map<string, string>; only?: (team: string) => boolean } = {}) => (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-line">
        {scores
          .filter((s) => !opts.only || opts.only(s.team))
          .map((s, i) => {
            const mine = s.team === "us";
            // Official results key teams by name; a tracked one gets its button chip.
            const trackedId = opts.names ? trackedTeamFor(opts.names.get(s.team) ?? null, config.teams)?.id : undefined;
            return (
              <tr key={s.team} className={mine ? "bg-brand-soft/60" : ""}>
                <td className="tnum w-8 py-1.5 pl-3 text-ink-3">{s.points !== null ? i + 1 : ""}</td>
                <td className="py-1.5">{teamChip(trackedId ?? s.team, opts.names?.get(s.team))}</td>
                <td className="tnum py-1.5 text-right font-semibold text-ink">{s.points !== null ? `${opts.approx ? "≈" : ""}${s.points}` : <span className="font-normal text-ink-3">{s.runners} counted</span>}</td>
                <td className="tnum hidden py-1.5 pr-3 pl-4 text-right text-xs text-ink-3 sm:table-cell">
                  {s.places.slice(0, 5).join("-")}
                  {s.places.length > 5 && ` (${s.places.slice(5).join(", ")})`}
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );

  const cp = viewId === "official" ? null : places.get(viewId)!;
  const overall = viewId === "official" ? official!.place : cp!.countingAll ? cp!.place : null;
  const ours = overall ? [...overall].sort((a, b) => a[1] - b[1]) : [];

  return (
    <Card className="mb-3 overflow-hidden">
      <div className="space-y-2 border-b border-line px-3 py-2">
        <span className="block text-sm font-semibold text-ink">Places</span>
        {views.length > 1 && <Segmented size="sm" scroll value={viewId} onChange={setPicked} options={views.map((v) => ({ value: v.id, label: v.label }))} />}
      </div>
      {cp ? (
        <>
          <p className="px-3 pt-2 text-xs text-ink-2">
            {cp.countingAll
              ? `${cp.entries.length} counted, everyone. Places are overall.`
              : `${cp.entries.length} counted: ours and the tracked teams. Places are among those teams.`}
          </p>
          <p className="px-3 pt-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Head to head</p>
          {scoreRows(cp.scores)}
          {cp.estimate && (
            <>
              <p className="px-3 pt-3 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Whole meet, estimated</p>
              {scoreRows(cp.estimate, { approx: true, only: (t) => t !== "*" })}
              <p className="px-3 pt-1 text-[11px] text-ink-3">Counts every Other runner as scoring; teams with under five runners don&rsquo;t, so the real scores are a little lower.</p>
            </>
          )}
        </>
      ) : (
        <>
          <p className="px-3 pt-2 text-xs text-ink-2">From the timing company&rsquo;s results, every team.</p>
          {scoreRows(official!.scores, { names: official!.names })}
        </>
      )}
      {config.awards.length > 0 && ours.length > 0 && (
        <>
          <p className="px-3 pt-3 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Award lines</p>
          <ul className="divide-y divide-line text-sm">
            {ours.map(([id, place]) => {
              const { made, next } = awardStatus(place, config.awards);
              return (
                <li key={id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate">
                    <span className="tnum mr-2 inline-block w-9 text-ink-3">{ordinal(place)}</span>
                    {athletes[id] ?? "?"}
                  </span>
                  <span className={`shrink-0 text-xs ${made && !next ? "font-semibold text-brand-text" : "text-ink-2"}`}>
                    {[made?.label, next ? `${next.places} from ${next.line.label.toLowerCase()}` : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="h-2" />
    </Card>
  );
}
