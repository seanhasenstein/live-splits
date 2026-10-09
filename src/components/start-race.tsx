"use client";

import { useEffect, useState, useTransition } from "react";
import { Alert, Button } from "@/components/ui";
import { useClock } from "@/lib/client/clock";

/**
 * Two taps to start a race: arm, then START the moment the gun goes off. The
 * armed button disarms itself after 15 s. A failed send keeps the exact
 * moment tapped so it can be retried; a 409 means someone else fired first.
 */
export function StartRaceControl({
  raceId,
  onStarted,
  onConflict,
  onArmedChange,
}: {
  raceId: string;
  /** The gun is recorded (ours, or the one that beat us to it). */
  onStarted: (gunTimeMs: number) => void;
  /** Someone else started the race first. */
  onConflict?: () => void;
  onArmedChange?: (armed: boolean) => void;
}) {
  const clock = useClock();
  const [armed, setArmedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const [pendingStart, setPendingStart] = useState<Record<string, unknown> | null>(null);
  const setArmed = (v: boolean) => {
    setArmedState(v);
    onArmedChange?.(v);
  };

  // Disarm on its own; a forgotten armed button is a misfire waiting to happen. Unmounting
  // while armed (someone else fired the gun) must also tell the parent it's no longer armed.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 15000);
    return () => {
      clearTimeout(t);
      onArmedChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  const sendStart = (payload: Record<string, unknown>) => {
    startSend(async () => {
      try {
        const res = await fetch("/api/taps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taps: [payload] }) });
        const body = (await res.json().catch(() => ({}))) as { error?: string; gunTimeMs?: number | null };
        if (res.status === 409) {
          setPendingStart(null);
          setError(body.error ?? "This race was already started.");
          onConflict?.();
          return;
        }
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setPendingStart(null);
        setError(null);
        onStarted(body.gunTimeMs ?? (payload.deviceTimeMs as number) + (payload.clockOffsetMs as number));
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

  return (
    <div>
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
      <p className="mt-1.5 text-xs text-ink-3">{armed ? "Tap START the moment the gun goes off." : "Shows the START button; it closes itself after 15 seconds."}</p>
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
    </div>
  );
}
