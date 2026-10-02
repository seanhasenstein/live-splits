"use client";

import { CircleCheck, Flag, MoreHorizontal, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { clearGunTimeAction, setGunTimeAction, setRaceFinishedAction } from "@/app/actions/races";
import { Alert, Badge, Button, Field, Input, Sheet, Time, RaceStateBadge } from "@/components/ui";
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
  /** CSV / Edit, shown on the title row for coaches. */
  headerActions?: React.ReactNode;
  gunTimeMs: number | null;
  finishedAt: string | null;
  firedBy: string | null;
  timeZone: string;
  canGun: boolean;
  /** Record splits / Live board, rendered inside the card; one version per race state so it can match. */
  actions?: Record<RaceState, React.ReactNode>;
};

/**
 * One race on the meet page, tinted by its state: not started (one action:
 * Start race…), in progress (big elapsed time; changes live behind "Adjust"),
 * finished (frozen). Nothing destructive is a single tap.
 */
export function RaceCard({ raceId, name, startLabel, details, headerActions, gunTimeMs: initialGun, finishedAt: initialFinished, firedBy, timeZone, canGun, actions }: Props) {
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

  // The START payload is kept so a failed send can be retried with the original
  // moment and id (the server dedupes on clientTapId).
  const [pendingStart, setPendingStart] = useState<Record<string, unknown> | null>(null);

  const sendStart = (payload: Record<string, unknown>) => {
    startSend(async () => {
      try {
        const res = await fetch("/api/taps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taps: [payload] }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; gunTimeMs?: number | null };
        if (res.status === 409) {
          // Someone else started it first; show their gun, don't overwrite it.
          setPendingStart(null);
          setError(body.error ?? "This race was already started.");
          router.refresh();
          return;
        }
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setPendingStart(null);
        setGunTimeMs(body.gunTimeMs ?? (payload.deviceTimeMs as number) + (payload.clockOffsetMs as number));
        setError(null);
        router.refresh();
      } catch (e) {
        setPendingStart(payload);
        setError(`${e instanceof Error ? e.message : "Couldn't record the start."} The moment you tapped is saved; retry to send it.`);
      }
    });
  };

  const fire = () => {
    const deviceTimeMs = Date.now();
    const sync = clock.sync;
    setArmed(false);
    if (!sync) {
      setError("The clock isn't synced yet. Try again in a second.");
      return;
    }
    sendStart({
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
    });
  };

  const running = gunTimeMs !== null && !finishedAt;
  const finished = gunTimeMs !== null && !!finishedAt;

  return (
    <div
      className={`rounded-lg border p-4 ${
        running ? "border-danger/40 bg-danger-soft/70" : finished ? "border-brand/40 bg-brand-soft/70" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {running ? <Timer className="size-4 text-danger" /> : finished ? <CircleCheck className="size-4 text-brand-text" /> : <Flag className="size-4 text-ink-2" />}
            <span className="text-base font-semibold text-ink">{name}</span>
            {startLabel && <Time className="text-sm text-ink-2">{startLabel}</Time>}
            <RaceStateBadge state={running ? "in_progress" : finished ? "finished" : "not_started"} />
            <ClockWarning sync={clock.sync} error={clock.error} />
          </div>
          <div className="mt-0.5 text-[13px] text-ink-2">{details}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {headerActions}
          {canGun && !armed && (
            <Button variant="subtle" size="sm" onClick={() => setAdjusting(true)} aria-label={gunTimeMs !== null ? "Adjust the race clock" : "Set the gun time by hand"}>
              <MoreHorizontal className="size-4" />
              {gunTimeMs !== null && "Adjust"}
            </Button>
          )}
        </div>
      </div>

      {gunTimeMs !== null ? (
        <div className="mt-3">
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
        <p className="mt-3 text-[13px] text-ink-2">Waiting for the start.</p>
      )}

      {error && (
        <div className="mt-2 space-y-2">
          <Alert tone="danger">{error}</Alert>
          {pendingStart && (
            <Button size="sm" onClick={() => sendStart(pendingStart)} disabled={sending}>
              {sending ? "Sending…" : "Retry sending the start"}
            </Button>
          )}
        </div>
      )}

      {actions && <div className="mt-3">{actions[running ? "in_progress" : finished ? "finished" : "not_started"]}</div>}

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
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}

        {gunTimeMs !== null && (
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
