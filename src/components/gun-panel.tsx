"use client";

import { Flag, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { clearGunTimeAction, setGunTimeAction, setRaceFinishedAction } from "@/app/actions/races";
import { Alert, Badge, Button, Field, Input, Sheet, Time } from "@/components/ui";
import { useClock } from "@/lib/client/clock";
import { formatClock, formatElapsed } from "@/lib/time";

type Props = {
  raceId: string;
  gunTimeMs: number | null;
  finishedAt: string | null;
  firedBy: string | null;
  timeZone: string;
  canGun: boolean;
};

/**
 * The race clock on the meet page. Three states: not started (one action:
 * Start race…), running (big elapsed time; changes live behind "Adjust"),
 * finished (frozen). Nothing destructive is a single tap.
 */
export function GunPanel({ raceId, gunTimeMs: initialGun, finishedAt: initialFinished, firedBy, timeZone, canGun }: Props) {
  const router = useRouter();
  const clock = useClock();
  const [gunTimeMs, setGunTimeMs] = useState(initialGun);
  const [finishedAt, setFinishedAt] = useState(initialFinished);
  const [seen, setSeen] = useState({ initialGun, initialFinished });
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const [adjusting, setAdjusting] = useState(false);

  // Server data changed underneath us (someone else set the gun): adopt it.
  if (initialGun !== seen.initialGun || initialFinished !== seen.initialFinished) {
    setSeen({ initialGun, initialFinished });
    setGunTimeMs(initialGun);
    setFinishedAt(initialFinished);
  }

  // Disarm on its own; a forgotten armed button is a misfire waiting to happen.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 15000);
    return () => clearTimeout(t);
  }, [armed]);

  const fire = () => {
    const deviceTimeMs = Date.now();
    const sync = clock.sync;
    setArmed(false);
    if (!sync) {
      setError("The clock isn't synced yet. Try again in a second.");
      return;
    }
    startSend(async () => {
      try {
        const res = await fetch("/api/taps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taps: [
              {
                clientTapId: crypto.randomUUID(),
                type: "gun",
                raceId,
                checkpointId: null,
                athleteId: null,
                targetTapId: null,
                deviceTimeMs,
                clockOffsetMs: sync.offsetMs,
                timeMs: null,
                estimate: false,
                missed: false,
                note: null,
              },
            ],
          }),
        });
        const body = (await res.json()) as { error?: string; gunTimeMs?: number | null };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setGunTimeMs(body.gunTimeMs ?? deviceTimeMs + sync.offsetMs);
        setError(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't record the start.");
      }
    });
  };

  const running = gunTimeMs !== null && !finishedAt;
  const finished = gunTimeMs !== null && !!finishedAt;

  return (
    <div className={`rounded-lg border p-3 ${running ? "border-brand/30 bg-brand-soft/60" : "border-line bg-surface-2/60"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Flag className={`size-4 ${running ? "text-brand-text" : "text-ink-2"}`} />
          <span className="text-[13px] font-medium text-ink">Race clock</span>
          {running ? (
            <Badge tone="brand" dot>
              Running
            </Badge>
          ) : finished ? (
            <Badge tone="neutral">Finished</Badge>
          ) : (
            <Badge tone="neutral" dot>
              Not started
            </Badge>
          )}
          <ClockWarning sync={clock.sync} error={clock.error} />
        </div>
        {canGun && !armed && (
          <Button variant="ghost" size="sm" onClick={() => setAdjusting(true)} aria-label={gunTimeMs !== null ? "Adjust the race clock" : "Set the gun time by hand"}>
            <MoreHorizontal className="size-4" />
            {gunTimeMs !== null && "Adjust"}
          </Button>
        )}
      </div>

      {gunTimeMs !== null ? (
        <div className="mt-2">
          <Elapsed gunTimeMs={gunTimeMs} finishedAt={finishedAt} now={clock.now} />
          <div className="mt-0.5 text-[13px] text-ink-2">
            Gun <Time>{formatClock(gunTimeMs, timeZone)}</Time>
            {firedBy && ` · by ${firedBy}`}
          </div>
        </div>
      ) : canGun ? (
        <div className="mt-3">
          {armed ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={fire}
                disabled={sending}
                className="h-16 flex-1 rounded-lg bg-brand text-2xl font-semibold tracking-wide text-brand-ink shadow-card active:bg-brand/80 disabled:opacity-50"
              >
                START
              </button>
              <Button variant="secondary" size="lg" onClick={() => setArmed(false)} className="h-16">
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="lg" onClick={() => setArmed(true)} disabled={sending || !clock.sync} className="w-full">
              {sending ? "Recording…" : "Start race…"}
            </Button>
          )}
          <p className="mt-1.5 text-xs text-ink-3">
            {armed ? "Tap START the moment the gun goes off." : "Shows the START button; it closes itself after 15 seconds."}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-ink-2">Waiting for the start.</p>
      )}

      {error && (
        <div className="mt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {adjusting && (
        <AdjustSheet
          raceId={raceId}
          gunTimeMs={gunTimeMs}
          finished={finished}
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
  timeZone,
  onClose,
  onChanged,
}: {
  raceId: string;
  gunTimeMs: number | null;
  finished: boolean;
  timeZone: string;
  onClose: () => void;
  onChanged: (next: { gunTimeMs?: number | null; finishedAt?: string | null }) => void;
}) {
  const [typed, setTyped] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
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
      else onChanged({ gunTimeMs: null, finishedAt: null });
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
      <div className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}

        {gunTimeMs !== null && (
          <section>
            {finished ? (
              <>
                <h3 className="text-sm font-semibold text-ink">Reopen the race</h3>
                <p className="mt-0.5 mb-2 text-[13px] text-ink-2">The clock runs again and the board goes back to live.</p>
                <Button variant="secondary" onClick={() => setFinished(false)} disabled={pending}>
                  Reopen race
                </Button>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-ink">Mark the race finished</h3>
                <p className="mt-0.5 mb-2 text-[13px] text-ink-2">
                  Stops the running clock on screen and turns the board into the review screen. Times are not changed.
                </p>
                <Button onClick={() => setFinished(true)} disabled={pending}>
                  Mark finished
                </Button>
              </>
            )}
          </section>
        )}

        <section>
          <h3 className="text-sm font-semibold text-ink">{gunTimeMs !== null ? "Change the gun time" : "Set the gun time by hand"}</h3>
          <p className="mt-0.5 mb-2 text-[13px] text-ink-2">Enter the clock time the gun went off. Every recorded time is re-based on it; nothing is deleted.</p>
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
        </section>

        {gunTimeMs !== null && (
          <section className="border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">Remove the gun time</h3>
            <p className="mt-0.5 mb-2 text-[13px] text-ink-2">Recorded times stay in the log; they show as clock times until a gun time is set again.</p>
            {confirmRemove ? (
              <div className="flex gap-2">
                <Button variant="danger" onClick={remove} disabled={pending}>
                  Yes, remove it
                </Button>
                <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
                  Keep it
                </Button>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmRemove(true)} className="text-danger hover:bg-danger-soft">
                Remove gun time…
              </Button>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}

function Elapsed({ gunTimeMs, finishedAt, now }: { gunTimeMs: number; finishedAt: string | null; now: () => number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (finishedAt) return;
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [finishedAt]);
  const end = finishedAt ? new Date(finishedAt).getTime() : now();
  if (end === null) return <Time className="text-3xl font-semibold text-ink">—</Time>;
  return <Time className="text-3xl font-semibold tracking-tight text-ink">{formatElapsed(end - gunTimeMs)}</Time>;
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
