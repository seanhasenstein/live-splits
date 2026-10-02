"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { clearGunTimeAction, setGunTimeAction } from "@/app/actions/races";
import { Flag } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Time } from "@/components/ui";
import { useClock } from "@/lib/client/clock";
import { formatClock, formatElapsed } from "@/lib/time";

type Props = {
  raceId: string;
  gunTimeMs: number | null;
  timeZone: string;
  canGun: boolean;
};

export function GunPanel({ raceId, gunTimeMs: initialGun, timeZone, canGun }: Props) {
  const router = useRouter();
  const clock = useClock();
  const [gunTimeMs, setGunTimeMs] = useState(initialGun);
  const [seenInitial, setSeenInitial] = useState(initialGun);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const [showSet, setShowSet] = useState(false);
  const [typed, setTyped] = useState("");

  // Server data changed underneath us (someone else set the gun): adopt it.
  if (initialGun !== seenInitial) {
    setSeenInitial(initialGun);
    setGunTimeMs(initialGun);
  }

  const saveTyped = (e: React.FormEvent) => {
    e.preventDefault();
    startSend(async () => {
      const result = await setGunTimeAction(raceId, typed);
      if (result.error) setError(result.error);
      else {
        setGunTimeMs(result.gunTimeMs ?? null);
        setError(null);
        setShowSet(false);
        router.refresh();
      }
    });
  };

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
      setError("Clock isn't synced yet; try again in a second.");
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
        setError(e instanceof Error ? e.message : "Could not record the gun");
      }
    });
  };

  const clear = () => {
    startSend(async () => {
      const result = await clearGunTimeAction(raceId);
      if (result.error) setError(result.error);
      else {
        setGunTimeMs(null);
        setError(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-lg border border-line bg-surface-2/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Flag className="size-4 text-ink-2" />
          <span className="text-[13px] font-medium text-ink">Gun</span>
          {gunTimeMs !== null ? (
            <Badge tone="brand" dot>
              Started
            </Badge>
          ) : (
            <Badge dot>Not started</Badge>
          )}
        </div>
        <ClockStatus sync={clock.sync} error={clock.error} />
      </div>

      {gunTimeMs !== null ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <Time className="text-xl font-semibold">{formatClock(gunTimeMs, timeZone)}</Time>
            <Elapsed gunTimeMs={gunTimeMs} now={clock.now} />
          </div>
          {canGun && (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setShowSet((s) => !s)}>
                Set
              </Button>
              <Button variant="ghost" size="sm" onClick={clear} disabled={sending} className="text-danger hover:bg-danger-soft">
                Clear
              </Button>
            </div>
          )}
        </div>
      ) : canGun ? (
        <div className="mt-2">
          {armed ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={fire}
                disabled={sending}
                className="h-16 flex-1 rounded-lg bg-gold text-2xl font-semibold tracking-wide text-gold-ink shadow-card active:bg-gold/80 disabled:opacity-50"
              >
                GUN
              </button>
              <Button variant="secondary" size="lg" onClick={() => setArmed(false)} className="h-16">
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="lg" onClick={() => setArmed(true)} disabled={sending || !clock.sync} className="flex-1">
                {sending ? "Recording…" : "Arm gun"}
              </Button>
              <Button variant="secondary" size="lg" onClick={() => setShowSet((s) => !s)}>
                Type time
              </Button>
            </div>
          )}
          <p className="mt-1.5 text-xs text-ink-3">Arm, then tap GUN at the start. It disarms itself after 15 seconds.</p>
        </div>
      ) : null}

      {showSet && canGun && (
        <form onSubmit={saveTyped} className="mt-3 flex items-end gap-2">
          <Field label={`Clock time the gun went off (24h, ${timeZone})`}>
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
          <Button type="submit" disabled={sending}>
            Save
          </Button>
        </form>
      )}
      {error && (
        <div className="mt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </div>
  );
}

function Elapsed({ gunTimeMs, now }: { gunTimeMs: number; now: () => number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, []);
  const n = now();
  if (n === null) return null;
  return (
    <span className="text-sm text-ink-2">
      <Time>{formatElapsed(n - gunTimeMs)}</Time> elapsed
    </span>
  );
}

function ClockStatus({ sync, error }: { sync: { offsetMs: number; rttMs: number; syncedAt: number } | null; error: string | null }) {
  if (error) return <span className="text-xs text-danger">clock: {error}</span>;
  if (!sync) return <span className="text-xs text-ink-3">syncing clock…</span>;
  const sign = sync.offsetMs >= 0 ? "+" : "−";
  return (
    <span className="tnum text-xs text-ink-3" title={`round trip ${sync.rttMs} ms`}>
      clock {sign}
      {Math.abs(sync.offsetMs)} ms
    </span>
  );
}
