"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClockSync } from "@/lib/client/clock";
import { outboxAdd, outboxAll, outboxRemove, type OutboxTap } from "@/lib/client/outbox";
import type { TapLike } from "@/lib/replay";
import type { TapInput } from "@/lib/taps";

type ServerTap = TapLike & { raceId: string; createdAt: string };

const POLL_MS = 2500;

const postTaps = (taps: OutboxTap[]) =>
  fetch("/api/taps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // queuedAt rides along; the server's schema strips it.
    body: JSON.stringify({ taps }),
  });
const RETRY_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * The live tap log for a race: what the server has, plus what this device has
 * queued but not yet delivered. Polls the server and flushes the outbox.
 */
export function useRaceTaps(raceId: string, initialGunTimeMs: number | null) {
  const [serverTaps, setServerTaps] = useState<Map<string, ServerTap>>(() => new Map());
  const [outbox, setOutbox] = useState<Map<string, OutboxTap>>(() => new Map());
  const [gunTimeMs, setGunTimeMs] = useState(initialGunTimeMs);
  const [online, setOnline] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [rejected, setRejected] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const since = useRef(0);
  const flushing = useRef(false);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  // --- polling -------------------------------------------------------------
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/races/${raceId}/taps?since=${since.current}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { taps: ServerTap[]; gunTimeMs: number | null; serverTimeMs: number };
      since.current = body.serverTimeMs;
      setGunTimeMs(body.gunTimeMs);
      if (body.taps.length > 0) {
        setServerTaps((prev) => {
          const next = new Map(prev);
          for (const t of body.taps) next.set(t.clientTapId, t);
          return next;
        });
      }
      setOnline(true);
      setLoaded(true);
    } catch {
      setOnline(false);
    }
  }, [raceId]);

  // Callers remount this hook per race (key={race.id}), so state starts fresh for each race.
  useEffect(() => {
    void poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [poll]);

  // --- outbox --------------------------------------------------------------
  const flushAgain = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current) {
      // Something was queued mid-flush; run once more when this one ends.
      flushAgain.current = true;
      return;
    }
    flushing.current = true;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    try {
      const pending = await outboxAll();
      const byRace = new Map<string, OutboxTap[]>();
      for (const t of pending) byRace.set(t.raceId, [...(byRace.get(t.raceId) ?? []), t]);
      for (const [rid, taps] of byRace) {
        const batch = taps.slice(0, 100);
        const res = await postTaps(batch);
        if (res.status === 401 || res.status === 403) {
          // Session gone: keep the taps, tell the person to rejoin.
          setSignedOut(true);
          flushAgain.current = false;
          return;
        }
        if (res.status === 400 || res.status === 404) {
          // One bad tap must not sink the batch: send the rest one by one and drop only rejects.
          for (const t of batch) {
            const one = await postTaps([t]);
            if (one.ok) {
              const body = (await one.json()) as { accepted: string[] };
              await outboxRemove(body.accepted);
            } else if (one.status === 400 || one.status === 404) {
              const body = (await one.json().catch(() => ({}))) as { error?: string };
              console.error("tap rejected", t.clientTapId, body.error);
              setRejected((n) => n + 1);
              await outboxRemove([t.clientTapId]);
            } else {
              throw new Error(`HTTP ${one.status}`);
            }
          }
          continue;
        }
        if (res.status === 409) {
          // The race was already started by someone else; this START is moot.
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          console.warn("tap rejected", rid, body.error);
          await outboxRemove(batch.filter((t) => t.type === "gun").map((t) => t.clientTapId));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { accepted: string[]; gunTimeMs: number | null };
        await outboxRemove(body.accepted);
        if (rid === raceId) {
          setGunTimeMs(body.gunTimeMs);
          // Keep showing accepted taps until the next poll returns them from the server.
          const accepted = new Set(body.accepted);
          setServerTaps((prev) => {
            const next = new Map(prev);
            for (const t of batch) {
              if (accepted.has(t.clientTapId) && !next.has(t.clientTapId)) {
                next.set(t.clientTapId, { ...t, serverTimeMs: t.deviceTimeMs + t.clockOffsetMs, createdAt: new Date().toISOString() });
              }
            }
            return next;
          });
        }
        // More than one batch queued for this race: go again, but only now that this one landed.
        if (taps.length > batch.length) flushAgain.current = true;
      }
      setSignedOut(false);
      failures.current = 0;
      setOnline(true);
    } catch {
      setOnline(false);
      flushAgain.current = false; // the retry timer owns the next attempt
      const delay = RETRY_MS[Math.min(failures.current++, RETRY_MS.length - 1)];
      retryTimer.current = setTimeout(() => void flushRef.current(), delay);
    } finally {
      flushing.current = false;
      setOutbox(new Map((await outboxAll()).map((t) => [t.clientTapId, t])));
      if (flushAgain.current) {
        flushAgain.current = false;
        void flushRef.current();
      }
    }
  }, [raceId]);

  useEffect(() => {
    flushRef.current = flush;
    const kick = setTimeout(() => void flush(), 0);
    const onOnline = () => void flush();
    const onVisible = () => document.visibilityState === "visible" && void flush();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(kick);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [flush]);

  /** Queue a tap: local first, then delivered in the background. */
  const send = useCallback(
    async (input: Omit<TapInput, "clientTapId" | "deviceTimeMs" | "clockOffsetMs" | "raceId"> & { deviceTimeMs?: number }) => {
      const sync = getClockSync();
      const tap: OutboxTap = {
        clientTapId: crypto.randomUUID(),
        raceId,
        deviceTimeMs: input.deviceTimeMs ?? Date.now(),
        clockOffsetMs: sync?.offsetMs ?? 0,
        ...input,
        queuedAt: Date.now(),
      };
      setOutbox((prev) => new Map(prev).set(tap.clientTapId, tap));
      await outboxAdd(tap);
      void flush();
      return tap.clientTapId;
    },
    [raceId, flush],
  );

  /** Server taps plus this device's unsent ones, as replay input. */
  const taps = useMemo<TapLike[]>(() => {
    const all = new Map<string, TapLike>(serverTaps);
    for (const t of outbox.values()) {
      if (t.raceId === raceId && !all.has(t.clientTapId)) {
        all.set(t.clientTapId, { ...t, serverTimeMs: t.deviceTimeMs + t.clockOffsetMs });
      }
    }
    return [...all.values()];
  }, [serverTaps, outbox, raceId]);

  const unsent = useMemo(() => [...outbox.values()].filter((t) => t.raceId === raceId).length, [outbox, raceId]);

  return { taps, gunTimeMs, send, online, signedOut, rejected, loaded, unsent, refresh: poll };
}
