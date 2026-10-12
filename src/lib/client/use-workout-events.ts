"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { offsetForTap } from "@/lib/client/clock";
import type { Workout, WorkoutEvent } from "@/lib/db/schema";
import type { WorkoutEventInput } from "@/lib/workout-events";

type Plan = Pick<Workout, "sets" | "groups" | "athletes"> & { finishedAt: string | null };
type Queued = WorkoutEventInput & { queuedAt: number };

const POLL_MS = 2_000;
const RETRY_MS = [1000, 2000, 4000, 8000, 15000];
const key = (workoutId: string) => `ls_workout_outbox_${workoutId}`;

/** This device's unsent events, kept in localStorage so a reload or a dead spot loses nothing. */
function loadQueue(workoutId: string): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(key(workoutId)) ?? "[]") as Queued[];
  } catch {
    return [];
  }
}
function saveQueue(workoutId: string, q: Queued[]) {
  try {
    localStorage.setItem(key(workoutId), JSON.stringify(q));
  } catch {
    // storage full or off: the in-memory queue still sends
  }
}

/**
 * A workout's live event log: what the server has plus what this phone has
 * queued but not yet delivered, and the current plan (it can change mid-way).
 */
export function useWorkoutEvents(workoutId: string, initial: Plan, timingGroupId: string | null = null) {
  const [serverEvents, setServerEvents] = useState<Map<string, WorkoutEvent>>(() => new Map());
  const [queue, setQueue] = useState<Queued[]>([]);
  const [plan, setPlan] = useState<Plan>(initial);
  const [online, setOnline] = useState(true);
  const [loaded, setLoaded] = useState(false);
  /** Who has a record screen open, and on which group. */
  const [recording, setRecording] = useState<{ name: string; groupId: string }[]>([]);
  const since = useRef(0);
  const sending = useRef(false);
  const failures = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/workouts/${workoutId}/events?since=${since.current}${timingGroupId ? `&at=${encodeURIComponent(timingGroupId)}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { events: WorkoutEvent[]; serverTimeMs: number; workout: Plan; recording: { name: string; groupId: string }[] };
      since.current = body.serverTimeMs;
      setPlan(body.workout);
      setRecording(body.recording);
      if (body.events.length) {
        setServerEvents((prev) => {
          const next = new Map(prev);
          for (const e of body.events) next.set(e.clientEventId, e);
          return next;
        });
      }
      setOnline(true);
      setLoaded(true);
    } catch {
      setOnline(false);
    }
  }, [workoutId, timingGroupId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        if (document.visibilityState === "visible") await poll();
      } finally {
        inFlight = false;
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    if (retry.current) clearTimeout(retry.current);
    try {
      const pending = loadQueue(workoutId);
      if (pending.length === 0) return;
      const batch = pending.slice(0, 100);
      const res = await fetch("/api/workout-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: batch }) });
      if (res.status === 400 || res.status === 403 || res.status === 404) {
        // Nothing to retry: drop them so the queue can't jam, and say so in the console.
        console.error("workout events rejected", res.status);
        const ids = new Set(batch.map((e) => e.clientEventId));
        const rest = loadQueue(workoutId).filter((e) => !ids.has(e.clientEventId));
        saveQueue(workoutId, rest);
        setQueue(rest);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { accepted: string[]; rejected?: string[] };
      const accepted = new Set(body.accepted);
      // Refused for good (a rep since dropped, the workout ended): drop them, or the queue would resend them forever.
      const rejected = new Set(body.rejected ?? []);
      if (rejected.size) console.error("workout events refused", [...rejected]);
      // Keep showing them until the next poll brings them back from the server.
      setServerEvents((prev) => {
        const next = new Map(prev);
        for (const e of batch) if (accepted.has(e.clientEventId) && !next.has(e.clientEventId)) next.set(e.clientEventId, asEvent(e));
        return next;
      });
      const rest = loadQueue(workoutId).filter((e) => !accepted.has(e.clientEventId) && !rejected.has(e.clientEventId));
      saveQueue(workoutId, rest);
      setQueue(rest);
      failures.current = 0;
      setOnline(true);
      // More waiting (a batch was capped at 100, or taps came in meanwhile): send on, but only after progress.
      if (rest.length && (accepted.size || rejected.size)) setTimeout(() => void flushRef.current(), 0);
    } catch {
      setOnline(false);
      retry.current = setTimeout(() => void flushRef.current(), RETRY_MS[Math.min(failures.current++, RETRY_MS.length - 1)]);
    } finally {
      sending.current = false;
    }
  }, [workoutId]);

  useEffect(() => {
    flushRef.current = flush;
    const kick = setTimeout(() => {
      setQueue(loadQueue(workoutId));
      void flush();
    }, 0);
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(kick);
      window.removeEventListener("online", onOnline);
      if (retry.current) clearTimeout(retry.current);
    };
  }, [flush, workoutId]);

  /** Queue an event; returns its id at once. `at` is when it happened on this device (default now). */
  const send = useCallback(
    (input: Pick<WorkoutEventInput, "type"> & Partial<Omit<WorkoutEventInput, "type" | "workoutId" | "clientEventId" | "deviceTimeMs" | "clockOffsetMs">> & { at?: number }): string => {
      const e: Queued = {
        clientEventId: crypto.randomUUID(),
        workoutId,
        type: input.type,
        groupId: input.groupId ?? null,
        athleteId: input.athleteId ?? null,
        repId: input.repId ?? null,
        targetEventId: input.targetEventId ?? null,
        deviceTimeMs: input.at ?? Date.now(),
        clockOffsetMs: offsetForTap(),
        timeMs: input.timeMs ?? null,
        note: input.note ?? null,
        queuedAt: Date.now(),
      };
      const next = [...loadQueue(workoutId), e];
      saveQueue(workoutId, next);
      setQueue(next);
      void flush();
      return e.clientEventId;
    },
    [workoutId, flush],
  );

  const events = useMemo(() => {
    const all = new Map(serverEvents);
    for (const e of queue) if (!all.has(e.clientEventId)) all.set(e.clientEventId, asEvent(e));
    return [...all.values()];
  }, [serverEvents, queue]);

  return { events, plan, send, online, loaded, unsent: queue.length, refresh: poll, recording };
}

function asEvent(e: Queued): WorkoutEvent {
  return {
    ...e,
    _id: e.clientEventId,
    schoolId: "",
    schemaVersion: 1,
    serverTimeMs: e.deviceTimeMs + e.clockOffsetMs,
    createdAt: new Date(e.queuedAt),
    createdBy: { type: "session", id: "", name: "" },
  } as WorkoutEvent;
}
