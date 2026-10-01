"use client";

import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Time } from "@/components/ui";
import { useClock } from "@/lib/client/clock";
import { useRaceTaps } from "@/lib/client/use-race-taps";
import { useWakeLock } from "@/lib/client/use-wake-lock";
import { type Mark, replay, type Slot } from "@/lib/replay";
import { formatClock, formatElapsed } from "@/lib/time";

type RaceInfo = {
  id: string;
  name: string;
  gunTimeMs: number | null;
  checkpoints: { id: string; label: string }[];
  athleteIds: string[];
};

type Props = {
  meetId: string;
  initial: { raceId: string | null; checkpointId: string | null };
  timeZone: string;
  races: RaceInfo[];
  athletes: Record<string, string>;
};

const DOUBLE_TAP_MS = 1000;
const TOAST_MS = 4000;
const FLASH_MS = 400;

/** The moment the user actually tapped, as epoch ms (more honest than Date.now() after React work). */
const eventTimeMs = (e: SyntheticEvent) => Math.round(performance.timeOrigin + e.nativeEvent.timeStamp);

export function TapScreen({ meetId, initial, timeZone, races, athletes }: Props) {
  useWakeLock();
  // Selection lives in the URL (?race=&cp=) so a reload lands on the same checkpoint.
  const [sel, setSel] = useState(() => {
    const r = races.find((x) => x.id === initial.raceId) ?? races[0];
    const c = r?.checkpoints.find((x) => x.id === initial.checkpointId) ?? r?.checkpoints[0];
    return { raceId: r?.id ?? "", checkpointId: c?.id ?? "" };
  });
  const race = races.find((r) => r.id === sel.raceId) ?? races[0];
  const cpIndex = Math.max(0, race?.checkpoints.findIndex((c) => c.id === sel.checkpointId) ?? 0);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("race", sel.raceId);
    url.searchParams.set("cp", sel.checkpointId);
    window.history.replaceState(window.history.state, "", url);
  }, [sel]);

  if (!race || race.checkpoints.length === 0) {
    return (
      <main className="p-6 text-sm">
        No races with checkpoints yet.{" "}
        <Link href={`/meets/${meetId}`} className="underline">
          Back to the meet
        </Link>
        .
      </main>
    );
  }

  return (
    <RaceTapper
      key={race.id}
      meetId={meetId}
      timeZone={timeZone}
      race={race}
      cpIndex={cpIndex}
      athletes={athletes}
      picker={
        <div className="flex gap-2">
          <select
            value={race.id}
            onChange={(e) => {
              const r = races.find((x) => x.id === e.target.value)!;
              setSel({ raceId: r.id, checkpointId: r.checkpoints[0]?.id ?? "" });
            }}
            className="min-w-0 flex-1 rounded border border-green/40 bg-white px-2 py-2 text-base font-bold"
          >
            {races.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select
            value={race.checkpoints[cpIndex].id}
            onChange={(e) => setSel({ raceId: race.id, checkpointId: e.target.value })}
            className="min-w-0 flex-1 rounded border border-green/40 bg-white px-2 py-2 text-base font-bold"
          >
            {race.checkpoints.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      }
    />
  );
}

type LastAction = { tapId: string; label: string };

function RaceTapper({
  meetId,
  timeZone,
  race,
  cpIndex,
  athletes,
  picker,
}: {
  meetId: string;
  timeZone: string;
  race: RaceInfo;
  cpIndex: number;
  athletes: Record<string, string>;
  picker: React.ReactNode;
}) {
  const clock = useClock();
  const checkpoint = race.checkpoints[cpIndex];
  const { taps, gunTimeMs, send, online, loaded, unsent } = useRaceTaps(race.id, race.gunTimeMs);
  const state = useMemo(
    () => replay({ checkpoints: race.checkpoints.map((c) => ({ ...c, distance: { value: 0, unit: "mi", meters: 0 }, kind: "split" })) }, taps),
    [race, taps],
  );
  const cp = state.get(checkpoint.id);
  const prev = cpIndex > 0 ? state.get(race.checkpoints[cpIndex - 1].id) : undefined;

  // Grid order: by the previous checkpoint's order; athletes not yet seen there go last, by name.
  const ordered = useMemo(() => {
    const prevTime = (id: string) => prev?.byAthlete.get(id)?.timeMs ?? Number.POSITIVE_INFINITY;
    return [...race.athleteIds].sort((a, b) => prevTime(a) - prevTime(b) || (athletes[a] ?? "").localeCompare(athletes[b] ?? ""));
  }, [race, prev, athletes]);

  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const lastTapAt = useRef(new Map<string, number>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Switching checkpoints: the undo target and any pending confirm no longer apply.
  const [seenCp, setSeenCp] = useState(checkpoint.id);
  if (seenCp !== checkpoint.id) {
    setSeenCp(checkpoint.id);
    setLastAction(null);
    setConfirmId(null);
  }

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const flash = (id: string) => {
    setFlashId(id);
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), FLASH_MS);
  };

  const fmt = useCallback(
    (ms: number | null) => (ms === null ? "—" : gunTimeMs ? formatElapsed(ms - gunTimeMs) : formatClock(ms, timeZone)),
    [gunTimeMs, timeZone],
  );

  const base = { checkpointId: checkpoint.id, athleteId: null, targetTapId: null, timeMs: null, estimate: false, missed: false, note: null };
  const offset = clock.sync?.offsetMs ?? 0;

  const capture = (e: SyntheticEvent) => {
    const deviceTimeMs = eventTimeMs(e);
    void send({ ...base, type: "capture", deviceTimeMs }).then((tapId) => setLastAction({ tapId, label: "capture" }));
    flash("capture");
    showToast(`Captured ${fmt(deviceTimeMs + offset)}`);
  };

  const record = (e: SyntheticEvent, athleteId: string, replacing: Mark | null) => {
    const deviceTimeMs = eventTimeMs(e);
    setConfirmId(null);
    if (replacing) void send({ ...base, type: "void", targetTapId: replacing.tapId, deviceTimeMs });
    const slot: Slot | undefined = cp?.pending[0];
    const promise = slot
      ? send({ ...base, type: "assign", athleteId, targetTapId: slot.tapId, deviceTimeMs })
      : send({ ...base, type: "name_tap", athleteId, deviceTimeMs });
    void promise.then((tapId) => setLastAction({ tapId, label: athletes[athleteId] ?? "tap" }));
    flash(athleteId);
    showToast(`${replacing ? "Replaced" : "Recorded"} ${athletes[athleteId]} ${fmt(slot ? slot.timeMs : deviceTimeMs + offset)}`);
  };

  const onName = (e: SyntheticEvent, athleteId: string) => {
    const now = eventTimeMs(e);
    const last = lastTapAt.current.get(athleteId) ?? 0;
    lastTapAt.current.set(athleteId, now);
    if (now - last < DOUBLE_TAP_MS) return; // double-tap guard
    const existing = cp?.byAthlete.get(athleteId);
    if (existing && !existing.missed) setConfirmId(athleteId);
    else record(e, athleteId, existing ?? null);
  };

  const undo = (e: SyntheticEvent) => {
    if (!lastAction) return;
    void send({ ...base, type: "void", targetTapId: lastAction.tapId, deviceTimeMs: eventTimeMs(e) });
    showToast(`Undid ${lastAction.label}`);
    setLastAction(null);
  };

  const deleteSlot = (e: SyntheticEvent, slot: Slot) => {
    void send({ ...base, type: "void", targetTapId: slot.tapId, deviceTimeMs: eventTimeMs(e) });
    if (lastAction?.tapId === slot.tapId) setLastAction(null);
    showToast(`Deleted ${fmt(slot.timeMs)}`);
  };

  return (
    <main className="flex min-h-dvh flex-col bg-cream">
      <header className="sticky top-0 z-10 border-b border-green/20 bg-cream px-3 pt-2 pb-2">
        {picker}
        <div className="mt-1.5 flex items-baseline justify-between text-xs text-green/70">
          <RaceClock gunTimeMs={gunTimeMs} now={clock.now} />
          <span>
            {!clock.sync && "syncing clock · "}
            {!online && <span className="font-bold text-red-700">offline · </span>}
            {unsent > 0 && <span className="font-bold text-gold">{unsent} unsent · </span>}
            <Link href={`/meets/${meetId}`} className="underline">
              meet
            </Link>
          </span>
        </div>
      </header>

      {cp && cp.pending.length > 0 && (
        <div className="border-b border-gold bg-gold-soft/60 px-3 py-2">
          <div className="text-xs font-bold uppercase tracking-wider text-green/80">
            {cp.pending.length} unassigned · tap a name to fill the oldest
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {cp.pending.map((s, i) => (
              <span key={s.tapId} className={`flex items-center gap-1 rounded bg-white px-2 py-1 text-sm ${i === 0 ? "ring-2 ring-gold" : ""}`}>
                <Time className="font-bold">{fmt(s.timeMs)}</Time>
                <button type="button" onClick={(e) => deleteSlot(e, s)} aria-label="Delete this capture" className="px-1 text-green/50 hover:text-red-700">
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid flex-1 grid-cols-2 content-start gap-2 p-3 pb-40">
        {!loaded && <p className="col-span-2 text-sm text-green/60">Loading…</p>}
        {ordered.map((id) => {
          const mark = cp?.byAthlete.get(id);
          const name = athletes[id] ?? "?";
          const [first, ...rest] = name.split(" ");
          const done = !!mark && !mark.missed;
          if (confirmId === id) {
            return (
              <div key={id} className="flex min-h-20 flex-col justify-center rounded border-2 border-gold bg-white p-2 text-center">
                <span className="text-sm">
                  Replace <Time className="font-bold">{fmt(mark?.timeMs ?? null)}</Time>?
                </span>
                <div className="mt-1 flex gap-1">
                  <button type="button" onClick={(e) => record(e, id, mark ?? null)} className="flex-1 rounded bg-green py-2 text-sm font-bold text-cream">
                    Replace
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className="flex-1 rounded border border-green py-2 text-sm font-bold">
                    Keep
                  </button>
                </div>
              </div>
            );
          }
          return (
            <button
              key={id}
              type="button"
              onClick={(e) => onName(e, id)}
              className={`min-h-20 rounded border-2 px-2 py-2 text-left transition-colors select-none ${
                flashId === id
                  ? "border-gold bg-gold text-green"
                  : done
                    ? "border-green/20 bg-cream text-green/60"
                    : "border-green bg-white text-green active:bg-gold-soft"
              }`}
            >
              <span className="block truncate text-xl leading-tight font-bold">{first}</span>
              <span className="block truncate text-sm">{rest.join(" ")}</span>
              {mark && (
                <Time className={`block text-sm ${mark.missed ? "italic" : "font-bold"}`}>
                  {mark.missed ? "missed" : fmt(mark.timeMs)}
                  {mark.estimate && " ~"}
                </Time>
              )}
            </button>
          );
        })}
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-20 flex justify-center px-3">
          <div className="pointer-events-auto flex items-center gap-3 rounded bg-green px-4 py-2.5 text-cream shadow-lg">
            <Time className="text-sm font-bold">{toast}</Time>
            {lastAction && (
              <button type="button" onClick={undo} className="rounded bg-gold px-3 py-1 text-xs font-bold uppercase tracking-wider text-green">
                Undo
              </button>
            )}
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t border-green/20 bg-cream p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={undo}
          disabled={!lastAction}
          className="w-24 rounded border-2 border-green py-4 text-sm font-bold uppercase tracking-wider text-green disabled:opacity-30"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={capture}
          className={`flex-1 rounded py-4 text-2xl font-bold tracking-widest text-green select-none ${flashId === "capture" ? "bg-gold-soft" : "bg-gold active:bg-gold-soft"}`}
        >
          CAPTURE
        </button>
      </div>
    </main>
  );
}

function RaceClock({ gunTimeMs, now }: { gunTimeMs: number | null; now: () => number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, []);
  const n = now();
  if (!gunTimeMs) return <span className="text-base font-bold text-gold">No gun yet</span>;
  if (n === null) return <span>—</span>;
  return <Time className="text-xl font-bold text-green">{formatElapsed(n - gunTimeMs)}</Time>;
}
