"use client";

import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Undo2, X } from "lucide-react";
import { Badge, Button, Segmented, Time, Toast } from "@/components/ui";
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
      <main className="p-6 text-sm text-ink-2">
        No races with checkpoints yet.{" "}
        <Link href={`/meets/${meetId}`} className="text-ink underline">
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
        <div className="space-y-1.5">
          {races.length > 1 && (
            <Segmented
              value={race.id}
              onChange={(id) => {
                const r = races.find((x) => x.id === id)!;
                setSel({ raceId: r.id, checkpointId: r.checkpoints[0]?.id ?? "" });
              }}
              options={races.map((r) => ({ value: r.id, label: r.name }))}
            />
          )}
          <Segmented
            value={race.checkpoints[cpIndex].id}
            onChange={(id) => setSel({ raceId: race.id, checkpointId: id })}
            options={race.checkpoints.map((c) => ({ value: c.id, label: c.label }))}
          />
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
    <main className="flex min-h-dvh flex-col bg-bg">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/95 px-3 pt-2 pb-2 backdrop-blur">
        {picker}
        <div className="mt-2 flex items-center justify-between">
          <RaceClock gunTimeMs={gunTimeMs} now={clock.now} />
          <div className="flex items-center gap-2 text-xs text-ink-2">
            {!clock.sync && <span>syncing clock…</span>}
            {!online && (
              <Badge tone="danger" dot>
                Offline
              </Badge>
            )}
            {unsent > 0 && <Badge tone="gold">{unsent} unsent</Badge>}
            <Link href={`/meets/${meetId}`} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Back to the meet">
              <ChevronLeft className="size-5" />
            </Link>
          </div>
        </div>
      </header>

      {cp && cp.pending.length > 0 && (
        <div className="border-b border-gold/40 bg-gold-soft px-3 py-2">
          <div className="flex items-center gap-2">
            <Badge tone="gold">{cp.pending.length} unassigned</Badge>
            <span className="text-xs text-gold-text">tap a name to fill the oldest</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {cp.pending.map((s, i) => (
              <span key={s.tapId} className={`flex items-center gap-0.5 rounded-md bg-surface py-0.5 pl-2 text-sm ${i === 0 ? "ring-2 ring-gold" : "border border-line"}`}>
                <Time className="font-semibold text-ink">{fmt(s.timeMs)}</Time>
                <button type="button" onClick={(e) => deleteSlot(e, s)} aria-label="Delete this capture" className="rounded p-1 text-ink-3 hover:text-danger">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid flex-1 grid-cols-2 content-start gap-2 p-3 pb-40">
        {!loaded && <p className="col-span-2 text-sm text-ink-3">Loading…</p>}
        {ordered.map((id) => {
          const mark = cp?.byAthlete.get(id);
          const name = athletes[id] ?? "?";
          const [first, ...rest] = name.split(" ");
          const done = !!mark && !mark.missed;
          if (confirmId === id) {
            return (
              <div key={id} className="flex min-h-20 flex-col justify-center rounded-lg border-2 border-gold bg-surface p-2 text-center shadow-card">
                <span className="text-sm text-ink">
                  Replace <Time className="font-semibold">{fmt(mark?.timeMs ?? null)}</Time>?
                </span>
                <div className="mt-1.5 flex gap-1.5">
                  <Button size="sm" onClick={(e) => record(e, id, mark ?? null)} className="flex-1">
                    Replace
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setConfirmId(null)} className="flex-1">
                    Keep
                  </Button>
                </div>
              </div>
            );
          }
          return (
            <button
              key={id}
              type="button"
              onClick={(e) => onName(e, id)}
              className={`min-h-20 rounded-lg border px-3 py-2 text-left transition-colors select-none ${
                flashId === id
                  ? "border-gold bg-gold text-gold-ink"
                  : done
                    ? "border-line bg-surface-2 text-ink-3"
                    : "border-line bg-surface text-ink shadow-card active:bg-gold-soft"
              }`}
            >
              <span className="block truncate text-xl leading-tight font-semibold">{first}</span>
              <span className={`block truncate text-sm ${done ? "" : "text-ink-2"}`}>{rest.join(" ")}</span>
              {mark && (
                <Time className={`block text-sm ${mark.missed ? "italic" : "font-semibold text-ink-2"}`}>
                  {mark.missed ? "missed" : fmt(mark.timeMs)}
                  {mark.estimate && !mark.missed && " ~"}
                </Time>
              )}
            </button>
          );
        })}
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-20 flex justify-center px-3">
          <Toast
            title={toast}
            action={
              lastAction ? (
                <Button size="sm" variant="secondary" onClick={undo}>
                  Undo
                </Button>
              ) : undefined
            }
          />
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t border-line bg-bg/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <Button variant="secondary" size="lg" onClick={undo} disabled={!lastAction} className="h-16 w-24">
          <Undo2 className="size-5" />
          Undo
        </Button>
        <button
          type="button"
          onClick={capture}
          className={`h-16 flex-1 rounded-lg text-2xl font-semibold tracking-wide text-gold-ink shadow-card select-none ${flashId === "capture" ? "bg-gold-soft" : "bg-gold active:bg-gold/80"}`}
        >
          Capture
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
  if (!gunTimeMs)
    return (
      <Badge tone="gold" dot>
        No gun yet
      </Badge>
    );
  if (n === null) return <span>—</span>;
  return <Time className="text-xl font-semibold text-ink">{formatElapsed(n - gunTimeMs)}</Time>;
}
