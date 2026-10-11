"use client";

import { useActionState, useState, useTransition } from "react";
import { commitHistoryAction, type HistoryLoadState, loadHistoryAction } from "@/app/actions/history";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, LinkButton, SectionLabel, Select } from "@/components/ui";
import type { HistoryCommitResult, HistoryReview } from "@/lib/results/history-import";
import type { HistoryMeet } from "@/lib/results/splits-history";
import { formatLocalDate } from "@/lib/time";

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
  const [include, setInclude] = useState<Record<number, boolean>>(() => Object.fromEntries(review.meets.map((m) => [m.index, m.existingMeetId === null])));
  const [venues, setVenues] = useState<Record<number, string>>(() => Object.fromEntries(review.meets.map((m) => [m.index, m.venueName])));
  const [gradYears, setGradYears] = useState<Record<string, string>>(() => Object.fromEntries(review.athletes.filter((a) => !a.athleteId).map((a) => [a.name, a.graduationYearGuess?.toString() ?? ""])));
  // For names the app didn't recognise: a new athlete ("" ) or an existing one's id. A lone same-surname candidate is only suggested, not assumed.
  const [identity, setIdentity] = useState<Record<string, string>>(() => Object.fromEntries(review.athletes.filter((a) => !a.athleteId).map((a) => [a.name, ""])));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<HistoryCommitResult | null>(null);
  const [pending, start] = useTransition();

  const chosen = review.meets.filter((m) => include[m.index]);
  const newAthletes = review.athletes.filter((a) => !a.athleteId);
  // Only names that appear in a chosen meet matter.
  const namesInChosen = new Set(chosen.flatMap((m) => meets[m.index].rows.map((r) => r.name)));
  const years = [...new Set(chosen.map((m) => m.date.slice(0, 4)))].sort();

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
        <CardHeader title="Past seasons imported" description={`${done.meets} meets, ${done.races} races, ${done.results} results · ${done.athletesCreated} athletes added as alumni · ${done.seasonsCreated} seasons created`} />
        <CardBody>
          <p className="text-[13px] text-ink-2">Results, season bests and course comparisons now reach back to the earliest season in the file. Alumni with a blank graduation year can be completed later.</p>
          <LinkButton href="/meets" className="mt-4">
            Back to meets
          </LinkButton>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={`${review.meets.length} meets in the file`} description={`${chosen.length} to import across ${years.join(", ") || "—"}. Untick a meet to leave it out. The venue gives each meet its course, for course bests.`} />
        <CardBody className="space-y-2">
          {review.meets.map((m) => (
            <div key={m.index} className="flex flex-col gap-2 rounded-md border border-line p-3 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <Checkbox
                  label={
                    <span>
                      <span className="font-medium text-ink">{m.name}</span>
                      <span className="text-ink-2"> · {formatLocalDate(m.date)} · {m.rows} results · {m.races.join(", ")}</span>
                    </span>
                  }
                  checked={!!include[m.index]}
                  disabled={m.existingMeetId !== null}
                  onChange={(e) => setInclude({ ...include, [m.index]: e.target.checked })}
                />
                {m.existingMeetId && (
                  <div className="mt-1 ml-6">
                    <Badge tone="neutral">already in the app</Badge>
                  </div>
                )}
              </div>
              {m.existingMeetId === null && (
                <Input
                  value={venues[m.index] ?? ""}
                  onChange={(e) => setVenues({ ...venues, [m.index]: e.target.value })}
                  placeholder="Venue (optional)"
                  list="history-venues"
                  maxLength={120}
                  className="sm:w-64"
                  aria-label={`Venue for ${m.name}`}
                />
              )}
            </div>
          ))}
          <datalist id="history-venues">
            {review.venues.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Athletes"
          description={`${review.athletes.length - newAthletes.length} names match athletes in the app. ${newAthletes.length} will be added as alumni; a graduation year lets the app work out their grade (four seasons in the file means a senior in the last one).`}
        />
        {newAthletes.length > 0 && (
          <CardBody className="space-y-2">
            <SectionLabel>New athletes</SectionLabel>
            {newAthletes.map((a) => {
              const same = review.allAthletes.filter((x) => x.gender === a.gender || x.gender === "X");
              return (
                <div key={a.name} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <span className="min-w-0 flex-1 text-sm text-ink">
                    {a.name} <span className="text-ink-3">· {a.gender === "F" ? "girls" : "boys"} · {a.seasons.join(", ")}</span>
                  </span>
                  <Select value={identity[a.name] ?? ""} onChange={(e) => setIdentity({ ...identity, [a.name]: e.target.value })} className="sm:w-56" aria-label={`Who is ${a.name}`}>
                    <option value="">New athlete (alumni)</option>
                    {a.candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — same last name
                      </option>
                    ))}
                    {same
                      .filter((x) => !a.candidates.some((c) => c.id === x.id))
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </Select>
                  {!identity[a.name] && (
                    <Input value={gradYears[a.name] ?? ""} onChange={(e) => setGradYears({ ...gradYears, [a.name]: e.target.value })} placeholder="Grad year" inputMode="numeric" maxLength={4} className="w-28" aria-label={`Graduation year for ${a.name}`} />
                  )}
                </div>
              );
            })}
          </CardBody>
        )}
      </Card>

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
