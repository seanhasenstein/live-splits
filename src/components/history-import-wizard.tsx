"use client";

import { Check } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { commitHistoryAction, type HistoryLoadState, loadHistoryAction } from "@/app/actions/history";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, LinkButton, SectionLabel, Segmented, Select, Stat } from "@/components/ui";
import { useTimeFormat } from "@/lib/client/time-format";
import type { HistoryCommitResult, HistoryReview } from "@/lib/results/history-import";
import type { HistoryMeet } from "@/lib/results/splits-history";
import { formatLocalDate } from "@/lib/time";

/** A class in a given season and when it graduates: a senior in 2025 is the class of 2026. */
const CLASSES = [
  { short: "Fr", yearsIn: 1, yearsLeft: 4 },
  { short: "So", yearsIn: 2, yearsLeft: 3 },
  { short: "Jr", yearsIn: 3, yearsLeft: 2 },
  { short: "Sr", yearsIn: 4, yearsLeft: 1 },
];

export function HistoryImportWizard() {
  const [state, load, loading] = useActionState(loadHistoryAction, {} as HistoryLoadState);
  if (state.meets && state.review) return <Review meets={state.meets} review={state.review} />;
  return (
    <form action={load}>
      <Card>
        <CardBody className="space-y-4 border-t-0">
          <Field label="Split sheets PDF" hint="One PDF covering the seasons to import. Meets already in the app (same name and date) are skipped.">
            <input name="file" type="file" accept="application/pdf" required className="block w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink" />
          </Field>
          {state.error && <Alert tone="danger">{state.error}</Alert>}
        </CardBody>
        <CardBody className="flex justify-end py-3">
          <Button type="submit" disabled={loading}>
            {loading ? "Reading…" : "Read the sheets"}
          </Button>
        </CardBody>
      </Card>
    </form>
  );
}

function Review({ meets, review }: { meets: HistoryMeet[]; review: HistoryReview }) {
  const { ft } = useTimeFormat();
  const [include, setInclude] = useState<Record<number, boolean>>(() => Object.fromEntries(review.meets.map((m) => [m.index, m.existingMeetId === null])));
  const [venues, setVenues] = useState<Record<number, string>>(() => Object.fromEntries(review.meets.map((m) => [m.index, m.venueName])));
  const [gradYears, setGradYears] = useState<Record<string, string>>(() => Object.fromEntries(review.athletes.filter((a) => !a.athleteId).map((a) => [a.name, a.graduationYearGuess?.toString() ?? ""])));
  // For names the app didn't recognise: a new athlete ("") or an existing one's id. A lone same-surname candidate is only suggested, not assumed.
  const [identity, setIdentity] = useState<Record<string, string>>(() => Object.fromEntries(review.athletes.filter((a) => !a.athleteId).map((a) => [a.name, ""])));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<HistoryCommitResult | null>(null);
  const [pending, start] = useTransition();

  const chosen = review.meets.filter((m) => include[m.index]);
  const namesInChosen = new Set(chosen.flatMap((m) => meets[m.index].rows.map((r) => r.name)));
  const unknown = review.athletes.filter((a) => !a.athleteId);
  const years = [...new Set(chosen.map((m) => Number(m.date.slice(0, 4))))].sort();
  const newSeasons = years.filter((y) => !review.seasons.includes(y));
  const resultsCount = chosen.reduce((n, m) => n + m.rows, 0);

  const commit = () => {
    if (chosen.length === 0) return setError("Tick at least one meet.");
    const athletes: Record<string, { athleteId: string } | { create: { graduationYear: number | null } }> = {};
    for (const a of review.athletes) {
      if (!namesInChosen.has(a.name)) continue;
      if (a.athleteId) athletes[a.name] = { athleteId: a.athleteId };
      else if (identity[a.name]) athletes[a.name] = { athleteId: identity[a.name] };
      else {
        const y = gradYears[a.name]?.trim() ?? "";
        if (y && !/^\d{4}$/.test(y)) return setError(`${a.name}: graduation year should be a 4-digit year, or blank.`);
        athletes[a.name] = { create: { graduationYear: y ? Number(y) : null } };
      }
    }
    setError(null);
    start(async () => {
      const res = await commitHistoryAction(
        JSON.stringify({
          meets: chosen.map((m) => meets[m.index]),
          choices: { meets: Object.fromEntries(chosen.map((m, i) => [i, { venueName: venues[m.index] ?? "" }])), athletes },
        }),
      );
      if (res.error) setError(res.error);
      else if (res.result) setDone(res.result);
    });
  };

  if (done) {
    return (
      <Card>
        <CardHeader title="Past seasons imported" description={`${done.meets} meets · ${done.races} races · ${done.results} results · ${done.athletesCreated} athletes added · ${done.seasonsCreated} seasons created`} />
        <CardBody>
          <p className="text-[13px] text-ink-2">Results, season bests and course comparisons now reach back to the earliest season in the file. An athlete added without a graduation year can be completed later.</p>
          <LinkButton href="/meets" className="mt-4">
            Back to meets
          </LinkButton>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* What the import will do, in one glance. */}
      <Card>
        <CardHeader title="What will be imported" />
        <CardBody className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Stat value={chosen.length} label={`of ${review.meets.length} meets`} />
          <Stat value={resultsCount} label="results" />
          <Stat value={review.athletes.length - unknown.length} label="athletes matched" />
          <Stat value={unknown.filter((a) => namesInChosen.has(a.name)).length} label="names to settle" tone={unknown.some((a) => namesInChosen.has(a.name)) ? "gold" : "ink"} />
        </CardBody>
        {years.length > 0 && (
          <CardBody className="p-0">
            <div className="px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Seasons</div>
            <div className="divide-y divide-line border-t border-line">
              {years.map((y) => {
                const inYear = chosen.filter((m) => m.date.startsWith(`${y}-`));
                return (
                  <div key={y} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="w-12 font-semibold text-ink">{y}</span>
                    <span className="flex-1 text-ink-2">
                      {inYear.length} meet{inYear.length === 1 ? "" : "s"} · {inYear.reduce((n, m) => n + m.rows, 0)} results
                    </span>
                    {newSeasons.includes(y) ? <Badge tone="gold">new season</Badge> : <Badge tone="neutral">in the app</Badge>}
                  </div>
                );
              })}
            </div>
          </CardBody>
        )}
      </Card>

      <section>
        <SectionLabel className="mb-2">Meets</SectionLabel>
        <div className="space-y-3">
          {review.meets.map((m) => {
            const meet = meets[m.index];
            const existing = m.existingMeetId !== null;
            const checked = !!include[m.index];
            return (
              <Card key={m.index} className={`overflow-hidden transition-colors ${existing ? "opacity-60" : checked ? "border-brand" : ""}`}>
                {/* The whole header is the switch: tap to take a meet in or out. */}
                <button
                  type="button"
                  disabled={existing}
                  onClick={() => setInclude({ ...include, [m.index]: !checked })}
                  aria-pressed={checked}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${checked ? "border-b border-brand/40 bg-brand-soft" : `bg-surface ${existing ? "cursor-default" : "hover:bg-surface-2"}`}`}
                >
                  <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${checked ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface"}`} aria-hidden>
                    {checked && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[15px] font-semibold text-ink">{m.name}</span>
                      {existing ? <Badge tone="neutral">already in the app</Badge> : !checked && <Badge tone="neutral">skipped</Badge>}
                    </span>
                    <span className="block text-[13px] text-ink-2">
                      {formatLocalDate(m.date)}, {m.date.slice(0, 4)} · {m.races.join(" · ")} · {m.rows} result{m.rows === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
                {checked && (
                  <CardBody className="py-3">
                    <Field label="Venue" hint="Gives the meet its course, for course bests. Leave blank if you're not sure; it can be set on the meet later.">
                      <Input value={venues[m.index] ?? ""} onChange={(e) => setVenues({ ...venues, [m.index]: e.target.value })} placeholder="Northbrook Golf & Grill" list="history-venues" maxLength={120} />
                    </Field>
                  </CardBody>
                )}
                {!existing && (
                  <CardBody className="overflow-x-auto p-0">
                    <table className={`w-full text-sm ${checked ? "" : "opacity-50"}`}>
                      <thead>
                        <tr className="border-b border-line text-left text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
                          <th className="px-4 py-2 font-semibold whitespace-nowrap">Athlete</th>
                          <th className="px-2 py-2 font-semibold whitespace-nowrap">Race</th>
                          {meet.checkpoints.map((c) => (
                            <th key={c.label} className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                              {c.label}
                            </th>
                          ))}
                          <th className="px-2 py-2 text-right font-semibold">Finish</th>
                          <th className="px-4 py-2 text-right font-semibold">Place</th>
                        </tr>
                      </thead>
                      <tbody>
                        {meet.rows.map((r, i) => {
                          const a = review.athletes.find((x) => x.name === r.name);
                          const settled = a?.athleteId || identity[r.name];
                          return (
                            <tr key={i} className="border-b border-line last:border-0">
                              <td className="px-4 py-1.5 text-ink whitespace-nowrap">
                                {r.name}
                                {!settled && <span className="ml-1.5 text-[11px] text-gold-text">new</span>}
                              </td>
                              <td className="px-2 py-1.5 text-ink-2 whitespace-nowrap">
                                {r.gender === "F" ? "Girls" : "Boys"} {r.level === "jv" ? "JV" : "V"}
                              </td>
                              {meet.checkpoints.map((c) => (
                                <td key={c.label} className="tnum px-2 py-1.5 text-right text-ink-2">
                                  {r.splits[c.label] !== undefined ? ft(r.splits[c.label], "seconds") : "—"}
                                </td>
                              ))}
                              <td className="tnum px-2 py-1.5 text-right font-medium text-ink">{r.finishMs !== null ? ft(r.finishMs, "seconds") : r.status.toUpperCase()}</td>
                              <td className="tnum px-4 py-1.5 text-right text-ink-2">{r.place ?? "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardBody>
                )}
              </Card>
            );
          })}
          <datalist id="history-venues">
            {review.venues.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
      </section>

      <section>
        <SectionLabel className="mb-2">Names the app doesn&rsquo;t know</SectionLabel>
        {unknown.length === 0 ? (
          <Card>
            <CardHeader title="Every name matched an athlete in the app" />
          </Card>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-2">
              Someone who ran in an earlier season but isn&rsquo;t on this year&rsquo;s roster is added as an athlete, so their results and PRs count. If a name is a different spelling of an athlete the app already has, pick them instead. Their class in their last season gives the app a graduation year, for grades; leave it if you&rsquo;re not sure.
            </p>
            {(["F", "M"] as const).map((g) => {
              const group = unknown.filter((a) => a.gender === g);
              if (group.length === 0) return null;
              return (
                <Card key={g}>
                  <CardHeader title={g === "F" ? "Girls" : "Boys"} description={`${group.length} name${group.length === 1 ? "" : "s"}`} />
                  <CardBody className="divide-y divide-line p-0">
                    {group.map((a) => {
                      const inChosen = namesInChosen.has(a.name);
                      const others = review.allAthletes.filter((x) => (x.gender === a.gender || x.gender === "X") && !a.candidates.some((c) => c.id === x.id));
                      const last = a.seasons[a.seasons.length - 1];
                      // Which class they could have been in their last season: with n seasons in the file they
                      // were at least n years in, so a 2-season runner wasn't a freshman in the second one.
                      const classes = CLASSES.filter((c) => c.yearsIn >= a.seasons.length);
                      return (
                        <div key={a.name} className={`space-y-3 px-4 py-3 ${inChosen ? "" : "opacity-50"}`}>
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <span className="text-sm font-medium text-ink">{a.name}</span>
                            <span className="text-[13px] text-ink-2">
                              {a.seasons.length > 1 ? `${a.seasons[0]}–${last}` : last}
                              {!inChosen && " · not in a ticked meet"}
                            </span>
                          </div>
                          <Select value={identity[a.name] ?? ""} onChange={(e) => setIdentity({ ...identity, [a.name]: e.target.value })} aria-label={`Who is ${a.name}`}>
                            <option value="">Add as a new athlete</option>
                            {a.candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} — same last name
                              </option>
                            ))}
                            {others.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </Select>
                          {!identity[a.name] && (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="text-[13px] text-ink-2">Class in {last}</span>
                              <Segmented
                                value={gradYears[a.name] ?? ""}
                                onChange={(v) => setGradYears({ ...gradYears, [a.name]: v })}
                                options={[{ value: "", label: "?" }, ...classes.map((c) => ({ value: String(last + c.yearsLeft), label: `${c.short} ’${String(last + c.yearsLeft).slice(2)}` }))]}
                                className="min-w-0 flex-1"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <LinkButton href="/meets/import-history" variant="secondary">
          Start over
        </LinkButton>
        <Button onClick={commit} disabled={pending || chosen.length === 0}>
          {pending ? "Importing…" : `Import ${chosen.length} meet${chosen.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
