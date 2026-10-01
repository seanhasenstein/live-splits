"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { clearGunTimeAction, setGunTimeAction } from "@/app/actions/races";
import { Button, ErrorText, Input, Time } from "@/components/ui";
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
    <div className="mt-3 rounded border border-green/30 bg-white p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-green/80">Gun</span>
        <ClockStatus sync={clock.sync} error={clock.error} />
      </div>

      {gunTimeMs !== null ? (
        <div className="mt-2 flex items-baseline justify-between">
          <div>
            <Time className="text-2xl font-bold">{formatClock(gunTimeMs, timeZone)}</Time>
            <Elapsed gunTimeMs={gunTimeMs} now={clock.now} />
          </div>
          {canGun && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowSet((s) => !s)} className="px-2 py-1 text-xs">
                Set
              </Button>
              <Button variant="danger" onClick={clear} disabled={sending} className="px-2 py-1 text-xs">
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
                className="flex-1 rounded bg-gold py-5 text-2xl font-bold tracking-widest text-green active:bg-gold-soft disabled:opacity-50"
              >
                GUN
              </button>
              <Button variant="secondary" onClick={() => setArmed(false)} className="px-3">
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button onClick={() => setArmed(true)} disabled={sending || !clock.sync} className="flex-1 py-4 text-lg">
                {sending ? "Recording…" : "Arm gun"}
              </Button>
              <Button variant="secondary" onClick={() => setShowSet((s) => !s)} className="px-3 text-xs">
                Type time
              </Button>
            </div>
          )}
          <p className="mt-1 text-xs text-green/60">Arm, then tap GUN at the start. It disarms itself after 15s.</p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-green/70">Not started.</p>
      )}

      {showSet && canGun && (
        <form onSubmit={saveTyped} className="mt-3 flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs text-green/70">Clock time the gun went off (24h, {timeZone})</span>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="19:10:03.4"
              pattern="\d{2}:\d{2}:\d{2}(\.\d)?"
              inputMode="numeric"
              required
              className="font-mono"
            />
          </label>
          <Button type="submit" disabled={sending} className="py-2.5">
            Save
          </Button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
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
    <span className="ml-3 text-sm text-green/70">
      <Time>{formatElapsed(n - gunTimeMs)}</Time> elapsed
    </span>
  );
}

function ClockStatus({ sync, error }: { sync: { offsetMs: number; rttMs: number; syncedAt: number } | null; error: string | null }) {
  if (error) return <span className="text-xs text-red-700">clock: {error}</span>;
  if (!sync) return <span className="text-xs text-green/60">syncing clock…</span>;
  const sign = sync.offsetMs >= 0 ? "+" : "−";
  return (
    <span className="text-xs text-green/60" title={`round trip ${sync.rttMs} ms`}>
      clock {sign}
      {Math.abs(sync.offsetMs)} ms
    </span>
  );
}
