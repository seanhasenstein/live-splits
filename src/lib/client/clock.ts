"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Device <-> server clock offset, NTP style: several round trips, keep the one
 * with the shortest round trip. Server time = device time + offsetMs.
 */
export type ClockSync = {
  offsetMs: number;
  /** Round-trip time of the sample that was kept, ms. */
  rttMs: number;
  /** Device time of the last successful sync. */
  syncedAt: number;
};

const STORAGE_KEY = "ls_clock";
const SAMPLES = 5;
const RESYNC_MS = 2 * 60 * 1000;

let current: ClockSync | null = null;
let inFlight: Promise<ClockSync> | null = null;
const listeners = new Set<() => void>();

const STALE_MS = 10 * 60 * 1000;

function load(): ClockSync | null {
  if (current) return current;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as ClockSync) : null;
    // A sync from an earlier day says nothing about this device's clock now; it's refreshed on load.
    if (saved && Date.now() - saved.syncedAt < STALE_MS) current = saved;
    else if (saved) lastKnown = saved;
  } catch {
    // storage unavailable; stay in memory only
  }
  return current;
}

/** An older sync, kept for stamping taps when a fresh one can't be had: phone clocks drift seconds a day, so it beats assuming zero. */
let lastKnown: ClockSync | null = null;

/** The offset to stamp a tap with: the current sync, else the last one this device ever had, else 0. */
export function offsetForTap(): number {
  return (current ?? lastKnown)?.offsetMs ?? 0;
}

function store(sync: ClockSync) {
  current = sync;
  lastKnown = sync;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sync));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

async function sample(): Promise<{ offsetMs: number; rttMs: number }> {
  const t0 = Date.now();
  const res = await fetch("/api/time", { cache: "no-store" });
  const t1 = Date.now();
  if (!res.ok) throw new Error(`time sync failed: ${res.status}`);
  const { serverTimeMs } = (await res.json()) as { serverTimeMs: number };
  const rttMs = t1 - t0;
  return { offsetMs: serverTimeMs - (t0 + rttMs / 2), rttMs };
}

export function syncClock(): Promise<ClockSync> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let best: { offsetMs: number; rttMs: number } | null = null;
    for (let i = 0; i < SAMPLES; i++) {
      try {
        const s = await sample();
        if (!best || s.rttMs < best.rttMs) best = s;
      } catch {
        // keep going; one good sample is enough
      }
    }
    if (!best) throw new Error("Could not reach the server to sync the clock");
    const sync = { offsetMs: Math.round(best.offsetMs), rttMs: best.rttMs, syncedAt: Date.now() };
    store(sync);
    return sync;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The current sync, if any (possibly stale). */
export function getClockSync(): ClockSync | null {
  return load();
}

/** Server-corrected now, or null if never synced. */
export function serverNow(): number | null {
  const sync = load();
  return sync ? Date.now() + sync.offsetMs : null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Keeps the clock synced while mounted: on mount, every 2 minutes, and when the tab comes back. */
export function useClock() {
  const sync = useSyncExternalStore(subscribe, load, () => null);
  const [error, setError] = useState<string | null>(null);

  const resync = useCallback(() => {
    syncClock()
      .then(() => setError(null))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const stale = !current || Date.now() - current.syncedAt > RESYNC_MS;
    if (stale) resync();
    const interval = setInterval(resync, RESYNC_MS);
    const onVisible = () => document.visibilityState === "visible" && resync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [resync]);

  return { sync, error, resync, now: () => (sync ? Date.now() + sync.offsetMs : null) };
}
