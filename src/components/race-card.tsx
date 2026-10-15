"use client";

import { ChevronRight, CircleCheck, Download, Flag, GitCompare, ListOrdered, MoreHorizontal, Pencil, Radio, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PlacesSetupSheet } from "@/components/places-setup";
import { StartRaceControl } from "@/components/start-race";
import type { RacePlaces } from "@/lib/db/schema";
import { clearGunTimeAction, findLiveFeedsAction, gunFromOfficialPreviewAction, type LiveFeedOption, setGunFromOfficialAction, setGunTimeAction, setLiveFeedAction, setRaceFinishedAction } from "@/app/actions/races";
import { Alert, Badge, Button, Field, Input, Sheet, Time, RaceStateBadge } from "@/components/ui";
import { RunningClock } from "@/components/race-status";
import { useClock } from "@/lib/client/clock";
import { formatClock, formatElapsed } from "@/lib/time";

export type RaceState = "not_started" | "in_progress" | "finished";

type Props = {
  raceId: string;
  name: string;
  /** "7:10 PM" or null. */
  startLabel: string | null;
  /** "Girls · Varsity + JV · 5K · 10 athletes · Mile 1, Mile 2, Finish" */
  details: string;
  /** Links offered in the "…" options sheet; null when this session can't use them. */
  editHref: string | null;
  csvHref: string | null;
  compareHref: string | null;
  gunTimeMs: number | null;
  finishedAt: string | null;
  firedBy: string | null;
  timeZone: string;
  canGun: boolean;
  /** True once official results were imported for this race. */
  hasOfficial: boolean;
  /** The timing company's live feed, polled while the race runs. */
  liveFeed: { url: string; contestName: string | null } | null;
  /** Place counting (tracked teams, award lines), if set up. */
  places: RacePlaces | null;
  /** Record splits / Live results, rendered inside the card; one version per race state so it can match. */
  actions?: Record<RaceState, React.ReactNode>;
};

/**
 * One race on the meet page, tinted by its state: not started (one action:
 * Start race…), in progress (big elapsed time; changes live behind "Adjust"),
 * finished (frozen). Nothing destructive is a single tap.
 */
export function RaceCard({ raceId, name, startLabel, details, editHref, csvHref, compareHref, gunTimeMs: initialGun, finishedAt: initialFinished, firedBy, timeZone, canGun, hasOfficial, liveFeed, places, actions }: Props) {
  const router = useRouter();
  const clock = useClock();
  const [gunTimeMs, setGunTimeMs] = useState(initialGun);
  const [finishedAt, setFinishedAt] = useState(initialFinished);
  const [seen, setSeen] = useState({ initialGun, initialFinished });
  const [armed, setArmed] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [options, setOptions] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);

  // Server data changed underneath us (someone else set the gun): adopt it.
  if (initialGun !== seen.initialGun || initialFinished !== seen.initialFinished) {
    setSeen({ initialGun, initialFinished });
    setGunTimeMs(initialGun);
    setFinishedAt(initialFinished);
  }

  // Finished stands on its own: imported results end a race even if nobody fired the gun in the app.
  const running = gunTimeMs !== null && !finishedAt;
  const finished = !!finishedAt;

  return (
    <div
      className={`rounded-lg border p-4 ${
        running ? "border-danger/40 bg-danger-soft/70" : finished ? "border-brand/40 bg-brand-soft/70" : "border-line bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex flex-wrap items-center gap-2">
            {running ? <Timer className="size-4 text-danger" /> : finished ? <CircleCheck className="size-4 text-brand-text" /> : <Flag className="size-4 text-ink-2" />}
            <span className="text-base font-semibold text-ink">{name}</span>
            {startLabel && <Time className="text-sm text-ink-2">{startLabel}</Time>}
            <RaceStateBadge state={running ? "in_progress" : finished ? "finished" : "not_started"} />
            {hasOfficial ? (
              <Badge tone="brand">Official results</Badge>
            ) : (
              liveFeed && (
                <Badge tone="brand" dot={running} pulse={running}>
                  Live results
                </Badge>
              )
            )}
            {canGun && <ClockWarning sync={clock.sync} error={clock.error} />}
          </div>
        </div>
        {(canGun || editHref || csvHref || compareHref) && !armed && (
          <div className="shrink-0 self-start">
            <Button variant="subtle" size="sm" onClick={() => setOptions(true)} aria-label={`Options for ${name}`}>
              <MoreHorizontal className="size-4" />
              Options
            </Button>
          </div>
        )}
      </div>
      <div className="mt-0.5 text-[13px] text-ink-2">{details}</div>

      {gunTimeMs !== null ? (
        <div className="mt-3">
          {/* The clock runs while the race does. Afterwards only the times of day matter: how long
              the race "took" is when the last runner finished, which is nobody's result. */}
          {!finishedAt && <RunningClock gunTimeMs={gunTimeMs} now={clock.now} className="text-3xl font-semibold tracking-tight text-ink" />}
          <div className="mt-0.5 text-[13px] text-ink-2">
            Gun <Time>{formatClock(gunTimeMs, timeZone)}</Time>
            {firedBy && ` · by ${firedBy}`}
            {finishedAt && (
              <>
                {" · finished "}
                <Time>{formatClock(new Date(finishedAt).getTime(), timeZone, false)}</Time>
              </>
            )}
          </div>
        </div>
      ) : finished ? (
        <p className="mt-3 text-[13px] text-ink-2">No gun time was recorded in the app.</p>
      ) : canGun ? (
        <div className="mt-3">
          <StartRaceControl
            raceId={raceId}
            onArmedChange={setArmed}
            onStarted={(gun) => {
              setGunTimeMs(gun);
              router.refresh();
            }}
            onConflict={() => router.refresh()}
          />
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-ink-2">Waiting for the start.</p>
      )}

      {actions && <div className="mt-3">{actions[running ? "in_progress" : finished ? "finished" : "not_started"]}</div>}

      {options && (
        <Sheet title={name} subtitle="Race options" onClose={() => setOptions(false)}>
          <div className="grid gap-1.5">
            {canGun && (
              <OptionRow
                icon={<Timer className="size-4" />}
                label={gunTimeMs !== null ? "Adjust the race clock…" : "Set the gun time by hand…"}
                hint={gunTimeMs !== null ? "Mark finished, change or remove the gun, link live results." : "Type the clock time the gun went off."}
                onClick={() => {
                  setOptions(false);
                  setAdjusting(true);
                }}
              />
            )}
            {canGun && (
              <OptionRow
                icon={<ListOrdered className="size-4" />}
                label={places?.on ? `Places · ${places.teams.length ? places.teams.map((t) => t.short).join(", ") : "no teams yet"}` : "Count places…"}
                hint={places?.on ? "Tracked teams, award lines, who sees places." : "Team buttons on Record splits: places, scores and award lines at each checkpoint."}
                onClick={() => {
                  setOptions(false);
                  setPlacesOpen(true);
                }}
              />
            )}
            {editHref && <OptionRow icon={<Pencil className="size-4" />} label="Edit race" hint="Name, checkpoints, lineup and running order." href={editHref} />}
            {csvHref && <OptionRow icon={<Download className="size-4" />} label="Download CSV" hint="Split-workbook layout, one row per athlete." href={csvHref} download />}
            {compareHref && <OptionRow icon={<GitCompare className="size-4" />} label="App vs official" hint="How close the taps were to the mats." href={compareHref} />}
          </div>
        </Sheet>
      )}

      {placesOpen && (
        <PlacesSetupSheet
          raceId={raceId}
          raceName={name}
          initial={places}
          onClose={() => setPlacesOpen(false)}
          onSaved={() => {
            setPlacesOpen(false);
            router.refresh();
          }}
        />
      )}

      {adjusting && (
        <AdjustSheet
          raceId={raceId}
          gunTimeMs={gunTimeMs}
          finished={finished}
          hasOfficial={hasOfficial}
          liveFeed={liveFeed}
          timeZone={timeZone}
          onClose={() => setAdjusting(false)}
          onChanged={(next) => {
            if (next.gunTimeMs !== undefined) setGunTimeMs(next.gunTimeMs);
            if (next.finishedAt !== undefined) setFinishedAt(next.finishedAt);
            setAdjusting(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AdjustSheet({
  raceId,
  gunTimeMs,
  finished,
  hasOfficial,
  liveFeed,
  timeZone,
  onClose,
  onChanged,
}: {
  raceId: string;
  gunTimeMs: number | null;
  finished: boolean;
  hasOfficial: boolean;
  liveFeed: { url: string; contestName: string | null } | null;
  timeZone: string;
  onClose: () => void;
  onChanged: (next: { gunTimeMs?: number | null; finishedAt?: string | null }) => void;
}) {
  const [typed, setTyped] = useState("");
  const [preview, setPreview] = useState<{ gunTimeMs: number; samples: number; spreadMs: number; currentMs: number | null } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const saveTyped = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const result = await setGunTimeAction(raceId, typed);
      if (result.error) setError(result.error);
      else onChanged({ gunTimeMs: result.gunTimeMs ?? null });
    });
  };

  const remove = () =>
    start(async () => {
      const result = await clearGunTimeAction(raceId);
      if (result.error) setError(result.error);
      // An imported race stays finished without its gun (the server keeps finishedAt).
      else onChanged({ gunTimeMs: null, ...(hasOfficial ? {} : { finishedAt: null }) });
    });

  const previewOfficial = () =>
    start(async () => {
      const r = await gunFromOfficialPreviewAction(raceId);
      if (r.error) setError(r.error);
      else setPreview({ gunTimeMs: r.gunTimeMs!, samples: r.samples!, spreadMs: r.spreadMs!, currentMs: r.currentMs ?? null });
    });

  const applyOfficial = () =>
    start(async () => {
      const r = await setGunFromOfficialAction(raceId);
      if (r.error) setError(r.error);
      else onChanged({ gunTimeMs: r.gunTimeMs ?? null });
    });

  const setFinished = (value: boolean) =>
    start(async () => {
      const result = await setRaceFinishedAction(raceId, value);
      if (result.error) setError(result.error);
      else onChanged({ finishedAt: value ? new Date().toISOString() : null });
    });

  return (
    <Sheet
      title="Race clock"
      subtitle={
        gunTimeMs ? (
          <>
            Gun at <Time>{formatClock(gunTimeMs, timeZone)}</Time>
          </>
        ) : (
          "No gun time yet"
        )
      }
      onClose={onClose}
    >
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}

        {(gunTimeMs !== null || finished) && (
          <Option
            title={finished ? "Reopen the race" : "Mark the race finished"}
            description={
              finished
                ? "The clock runs again and the board goes back to live."
                : "Stops the running clock on screen and turns the board into the review screen. Times are not changed."
            }
            action={
              finished ? (
                <Button variant="secondary" onClick={() => setFinished(false)} disabled={pending}>
                  Reopen race
                </Button>
              ) : confirmFinish ? (
                <div className="flex gap-2">
                  <Button onClick={() => setFinished(true)} disabled={pending}>
                    Yes, mark finished
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmFinish(false)}>
                    Not yet
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmFinish(true)} disabled={pending}>
                  Mark finished…
                </Button>
              )
            }
          />
        )}

        {hasOfficial && (
          <Option
            title="Set the gun from official results"
            description="Lines the app's splits up with the mats: gun = app finish tap − official finish, median across runners."
            action={
              preview ? (
                <div className="space-y-2">
                  <p className="tnum text-[13px] text-ink">
                    Gun <Time>{formatClock(preview.gunTimeMs, timeZone)}</Time> from {preview.samples} runner{preview.samples === 1 ? "" : "s"} (spread {formatElapsed(preview.spreadMs)})
                    {preview.currentMs !== null && (
                      <>
                        {" · "}
                        {preview.gunTimeMs - preview.currentMs >= 0 ? "+" : "−"}
                        {formatElapsed(Math.abs(preview.gunTimeMs - preview.currentMs))} vs now
                      </>
                    )}
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={applyOfficial} disabled={pending}>
                      Use this gun time
                    </Button>
                    <Button variant="secondary" onClick={() => setPreview(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" onClick={previewOfficial} disabled={pending}>
                  Calculate…
                </Button>
              )
            }
          />
        )}

        {!hasOfficial && !finished && (
          <Option
            title="Live official results"
            description="Paste the timing company's results link. While the race runs, the board polls it (at most every 15 s) and shows official finishes as they post. Import the results after the race as usual."
            action={<LiveFeedControl raceId={raceId} liveFeed={liveFeed} onSaved={() => onChanged({})} />}
          />
        )}

        <Option
          title={gunTimeMs !== null ? "Change the gun time" : "Set the gun time by hand"}
          description="Enter the clock time the gun went off. Every recorded time is re-based on it; nothing is deleted."
          action={
            <form onSubmit={saveTyped} className="flex items-end gap-2">
              <Field label={`24-hour clock time, ${timeZone}`}>
                <Input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="19:10:03.4"
                  pattern="\d{2}:\d{2}:\d{2}(\.\d)?"
                  inputMode="numeric"
                  required
                  className="font-mono"
                />
              </Field>
              <Button type="submit" variant="secondary" disabled={pending}>
                Save
              </Button>
            </form>
          }
        />

        {gunTimeMs !== null && (
          <Option
            title="Remove the gun time"
            description="Recorded times stay in the log; they show as clock times until a gun time is set again."
            danger
            action={
              confirmRemove ? (
                <div className="flex gap-2">
                  <Button variant="danger" onClick={remove} disabled={pending}>
                    Yes, remove it
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
                    Keep it
                  </Button>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setConfirmRemove(true)}>
                  Remove gun time…
                </Button>
              )
            }
          />
        )}
      </div>
    </Sheet>
  );
}

/** Link / unlink the live feed: paste a link, pick the contest, save. */
function LiveFeedControl({ raceId, liveFeed, onSaved }: { raceId: string; liveFeed: { url: string; contestName: string | null } | null; onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [options, setOptions] = useState<LiveFeedOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const find = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await findLiveFeedsAction(raceId, url);
      if (r.error) return setError(r.error);
      setError(null);
      setOptions(r.options!);
    });
  };
  const save = (feed: { url: string; contestName: string | null } | null) =>
    start(async () => {
      const r = await setLiveFeedAction(raceId, feed);
      if (r.error) return setError(r.error);
      onSaved();
    });

  if (liveFeed) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-[13px] text-ink">
          <Radio className="size-3.5 text-brand-text" />
          <span className="font-medium">{liveFeed.contestName ?? "Linked"}</span>
          <span className="truncate text-ink-3">{new URL(liveFeed.url).host}</span>
        </p>
        <Button variant="secondary" size="sm" onClick={() => save(null)} disabled={pending}>
          Remove link
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {error && <Alert tone="danger">{error}</Alert>}
      {options ? (
        <div className="grid gap-1.5">
          <p className="text-[13px] text-ink-2">Which contest is this race?</p>
          {options.map((o) => (
            <button
              key={o.url}
              type="button"
              onClick={() => save({ url: o.url, contestName: o.name })}
              disabled={pending}
              className="flex h-11 items-center justify-between rounded-md border border-line bg-surface px-3 text-left text-sm text-ink hover:bg-surface-2"
            >
              <span>{o.name}</span>
              <span className="text-xs text-ink-3">{o.entries} runners so far</span>
            </button>
          ))}
          <Button variant="subtle" size="sm" onClick={() => setOptions(null)} className="justify-self-start">
            Different link
          </Button>
        </div>
      ) : (
        <form onSubmit={find} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Results link">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" required />
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Reading…" : "Find"}
          </Button>
        </form>
      )}
    </div>
  );
}

/** A labelled row in the options sheet: a link, or a button. */
function OptionRow({ icon, label, hint, href, download, onClick }: { icon: React.ReactNode; label: string; hint: string; href?: string; download?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span className="text-ink-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-2">{hint}</span>
      </span>
      <ChevronRight className="size-4 text-ink-3" />
    </>
  );
  const cls = "flex h-14 w-full items-center gap-3 rounded-lg border border-line bg-surface px-4 text-left hover:bg-surface-2";
  if (href)
    return (
      <a href={href} download={download} className={cls}>
        {inner}
      </a>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/** One action in the adjust sheet: title, what it does, the control. */
function Option({ title, description, action, danger }: { title: string; description: string; action: React.ReactNode; danger?: boolean }) {
  return (
    <section className={`rounded-lg border p-3 ${danger ? "border-danger/30" : "border-line"}`}>
      <h3 className={`text-sm font-semibold ${danger ? "text-danger" : "text-ink"}`}>{title}</h3>
      <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>
      <div className="mt-3">{action}</div>
    </section>
  );
}


/** Only speaks up when something is wrong with the device clock. */
export function ClockWarning({ sync, error }: { sync: { offsetMs: number; rttMs: number } | null; error: string | null }) {
  if (error || !sync)
    return (
      <Badge tone="danger" dot>
        Clock not synced
      </Badge>
    );
  if (sync.rttMs > 2000)
    return (
      <Badge tone="gold" dot>
        Slow connection
      </Badge>
    );
  return null;
}
