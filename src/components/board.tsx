"use client";

import Link from "next/link";
import { type ReactNode, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Time } from "@/components/ui";
import { useClock } from "@/lib/client/clock";
import { useRaceTaps } from "@/lib/client/use-race-taps";
import { type CheckpointState, type Mark, replay, type Slot } from "@/lib/replay";
import { formatClock, formatElapsed, parseElapsed } from "@/lib/time";

type RaceInfo = {
  id: string;
  name: string;
  gunTimeMs: number | null;
  checkpoints: { id: string; label: string }[];
  athleteIds: string[];
};

type Props = {
  meetId: string;
  initialRaceId: string | null;
  timeZone: string;
  races: RaceInfo[];
  athletes: Record<string, string>;
  canFix: boolean;
  canTap: boolean;
};

const eventTimeMs = (e: SyntheticEvent) => Math.round(performance.timeOrigin + e.nativeEvent.timeStamp);

export function Board({ meetId, initialRaceId, timeZone, races, athletes, canFix, canTap }: Props) {
  const [raceId, setRaceId] = useState(() => (races.some((r) => r.id === initialRaceId) ? initialRaceId! : (races[0]?.id ?? "")));
  const race = races.find((r) => r.id === raceId) ?? races[0];

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("race", raceId);
    window.history.replaceState(window.history.state, "", url);
  }, [raceId]);

  if (!race) {
    return (
      <main className="p-6 text-sm">
        No races yet.{" "}
        <Link href={`/meets/${meetId}`} className="underline">
          Back to the meet
        </Link>
        .
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col bg-cream">
      <header className="sticky top-0 z-10 border-b border-green/20 bg-cream px-3 pt-2 pb-2">
        <div className="flex gap-1">
          {races.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRaceId(r.id)}
              className={`flex-1 rounded px-2 py-2 text-sm font-bold uppercase tracking-wider ${r.id === race.id ? "bg-green text-cream" : "border border-green/40 text-green"}`}
            >
              {r.name}
            </button>
          ))}
        </div>
      </header>
      <RaceBoard key={race.id} meetId={meetId} race={race} timeZone={timeZone} athletes={athletes} canFix={canFix} canTap={canTap} />
    </main>
  );
}

type Row = { athleteId: string; marks: (Mark | undefined)[]; reached: number };

function RaceBoard({
  meetId,
  race,
  timeZone,
  athletes,
  canFix,
  canTap,
}: {
  meetId: string;
  race: RaceInfo;
  timeZone: string;
  athletes: Record<string, string>;
  canFix: boolean;
  canTap: boolean;
}) {
  const clock = useClock();
  const { taps, gunTimeMs, send, online, loaded } = useRaceTaps(race.id, race.gunTimeMs);
  const state = useMemo(
    () => replay({ checkpoints: race.checkpoints.map((c) => ({ ...c, distance: { value: 0, unit: "mi", meters: 0 }, kind: "split" })) }, taps),
    [race, taps],
  );
  const [fix, setFix] = useState<{ athleteId: string; cpIndex: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const fmt = useCallback(
    (ms: number | null) => (ms === null ? "—" : gunTimeMs ? formatElapsed(ms - gunTimeMs) : formatClock(ms, timeZone)),
    [gunTimeMs, timeZone],
  );

  const rows = useMemo<Row[]>(() => {
    const cps = race.checkpoints.map((c) => state.get(c.id));
    const rows = race.athleteIds.map((athleteId) => {
      const marks = cps.map((cp) => cp?.byAthlete.get(athleteId));
      let reached = -1;
      marks.forEach((m, i) => {
        if (m && !m.missed) reached = i;
      });
      return { athleteId, marks, reached };
    });
    return rows.sort((a, b) => {
      if (a.reached !== b.reached) return b.reached - a.reached;
      if (a.reached >= 0) return (a.marks[a.reached]!.timeMs ?? 0) - (b.marks[b.reached]!.timeMs ?? 0);
      return (athletes[a.athleteId] ?? "").localeCompare(athletes[b.athleteId] ?? "");
    });
  }, [race, state, athletes]);

  const pendingTotal = race.checkpoints.reduce((n, c) => n + (state.get(c.id)?.pending.length ?? 0), 0);

  return (
    <>
      <div className="flex items-baseline justify-between px-3 pt-2 text-xs text-green/70">
        <RaceClock gunTimeMs={gunTimeMs} now={clock.now} />
        <span>
          {!online && <span className="font-bold text-red-700">offline · </span>}
          {canTap && (
            <Link href={`/meets/${meetId}/tap?race=${race.id}`} className="underline">
              tap
            </Link>
          )}
          {canTap && " · "}
          <Link href={`/meets/${meetId}`} className="underline">
            meet
          </Link>
        </span>
      </div>

      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-green text-left text-[11px] font-bold uppercase tracking-wider">
            <th className="py-1.5 pl-3">Athlete</th>
            {race.checkpoints.map((c) => (
              <th key={c.id} className="py-1.5 pr-3 text-right">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!loaded && (
            <tr>
              <td colSpan={race.checkpoints.length + 1} className="px-3 py-3 text-green/60">
                Loading…
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.athleteId} className={`border-b border-green/15 ${row.reached < 0 ? "text-green/40" : ""}`}>
              <td className="py-1.5 pl-3 font-bold">{athletes[row.athleteId]}</td>
              {row.marks.map((m, i) => {
                const prevTime = i > 0 ? (row.marks[i - 1]?.timeMs ?? null) : gunTimeMs;
                const split = m?.timeMs != null && prevTime != null ? m.timeMs - prevTime : null;
                const cell = (
                  <>
                    <Time className={`block font-bold ${m?.missed ? "font-normal italic" : ""}`}>
                      {m ? (m.missed ? "missed" : fmt(m.timeMs)) : "—"}
                      {m && !m.missed && (m.estimate ? "~" : m.edited ? "*" : "")}
                    </Time>
                    {split !== null && i > 0 && <Time className="block text-[11px] text-green/60">+{formatElapsed(split)}</Time>}
                  </>
                );
                return (
                  <td key={race.checkpoints[i].id} className="py-1 pr-3 text-right align-top">
                    {canFix ? (
                      <button type="button" onClick={() => setFix({ athleteId: row.athleteId, cpIndex: i })} className="w-full rounded px-1 text-right active:bg-gold-soft">
                        {cell}
                      </button>
                    ) : (
                      cell
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {pendingTotal > 0 && (
        <div className="mx-3 mt-3 rounded border border-gold bg-gold-soft/50 px-3 py-2 text-sm">
          <span className="font-bold">{pendingTotal} unassigned capture{pendingTotal === 1 ? "" : "s"}</span>
          {race.checkpoints.map((c) => {
            const p = state.get(c.id)?.pending ?? [];
            return p.length ? (
              <div key={c.id}>
                {c.label}: {p.map((s) => fmt(s.timeMs)).join(", ")}
              </div>
            ) : null;
          })}
          {canFix && <div className="text-xs text-green/70">Tap an athlete&rsquo;s empty cell to give them one.</div>}
        </div>
      )}

      <p className="px-3 py-3 text-[11px] text-green/60">
        * edited &nbsp; ~ estimate &nbsp; Updates every few seconds.{canFix && " Tap a time to fix it."}
      </p>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-3">
          <div className="rounded bg-green px-4 py-2 text-sm font-bold text-cream shadow-lg">{toast}</div>
        </div>
      )}

      {fix && (
        <FixSheet
          race={race}
          cpIndex={fix.cpIndex}
          athleteId={fix.athleteId}
          cp={state.get(race.checkpoints[fix.cpIndex].id)}
          athletes={athletes}
          gunTimeMs={gunTimeMs}
          fmt={fmt}
          send={send}
          onClose={() => setFix(null)}
          onDone={(msg) => {
            setFix(null);
            showToast(msg);
          }}
        />
      )}
    </>
  );
}

type Send = ReturnType<typeof useRaceTaps>["send"];

function FixSheet({
  race,
  cpIndex,
  athleteId,
  cp,
  athletes,
  gunTimeMs,
  fmt,
  send,
  onClose,
  onDone,
}: {
  race: RaceInfo;
  cpIndex: number;
  athleteId: string;
  cp: CheckpointState | undefined;
  athletes: Record<string, string>;
  gunTimeMs: number | null;
  fmt: (ms: number | null) => string;
  send: Send;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const checkpoint = race.checkpoints[cpIndex];
  const mark = cp?.byAthlete.get(athleteId);
  const name = athletes[athleteId] ?? "?";
  const [mode, setMode] = useState<"menu" | "type" | "move" | "swap" | "add">("menu");
  const [typed, setTyped] = useState("");
  const [estimate, setEstimate] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const base = { checkpointId: checkpoint.id, athleteId: null, targetTapId: null, timeMs: null, estimate: false, missed: false, note: null };
  const others = race.athleteIds.filter((id) => id !== athleteId);
  const withoutTime = others.filter((id) => !cp?.byAthlete.get(id) || cp.byAthlete.get(id)!.missed);
  const withTime = others.filter((id) => cp?.byAthlete.get(id) && !cp.byAthlete.get(id)!.missed);

  const absolute = (text: string): number | null => {
    const ms = parseElapsed(text);
    if (ms === null) return null;
    return gunTimeMs ? gunTimeMs + ms : null;
  };

  const nudge = (e: SyntheticEvent, deltaMs: number) => {
    if (!mark?.timeMs) return;
    void send({ ...base, type: "edit", targetTapId: mark.tapId, timeMs: mark.timeMs + deltaMs, deviceTimeMs: eventTimeMs(e) });
    onDone(`${name}: ${fmt(mark.timeMs + deltaMs)}`);
  };

  const saveTyped = (e: SyntheticEvent) => {
    e.preventDefault();
    const timeMs = absolute(typed);
    if (timeMs === null) return setError(gunTimeMs ? "Use m:ss.t, like 6:02.4" : "Set the gun time first");
    if (mark && !mark.missed) {
      void send({ ...base, type: "edit", targetTapId: mark.tapId, timeMs, deviceTimeMs: eventTimeMs(e) });
    } else {
      if (mark) void send({ ...base, type: "void", targetTapId: mark.tapId, deviceTimeMs: eventTimeMs(e) });
      void send({ ...base, type: "name_tap", athleteId, timeMs, estimate, deviceTimeMs: eventTimeMs(e) });
    }
    onDone(`${name}: ${fmt(timeMs)}${estimate && !(mark && !mark.missed) ? " (estimate)" : ""}`);
  };

  const moveTo = (e: SyntheticEvent, toId: string) => {
    if (!mark) return;
    const displaced = cp?.byAthlete.get(toId);
    if (displaced) void send({ ...base, type: "void", targetTapId: displaced.tapId, deviceTimeMs: eventTimeMs(e) });
    void send({ ...base, type: "edit", targetTapId: mark.tapId, athleteId: toId, deviceTimeMs: eventTimeMs(e) });
    onDone(`Moved ${fmt(mark.timeMs)} to ${athletes[toId]}`);
  };

  const swapWith = (e: SyntheticEvent, otherId: string) => {
    const other = cp?.byAthlete.get(otherId);
    if (!mark || !other) return;
    const t = eventTimeMs(e);
    void send({ ...base, type: "edit", targetTapId: mark.tapId, athleteId: otherId, deviceTimeMs: t });
    void send({ ...base, type: "edit", targetTapId: other.tapId, athleteId, deviceTimeMs: t + 1 });
    onDone(`Swapped ${name} and ${athletes[otherId]}`);
  };

  const assignSlot = (e: SyntheticEvent, slot: Slot) => {
    if (mark) void send({ ...base, type: "void", targetTapId: mark.tapId, deviceTimeMs: eventTimeMs(e) });
    void send({ ...base, type: "assign", athleteId, targetTapId: slot.tapId, deviceTimeMs: eventTimeMs(e) });
    onDone(`${name}: ${fmt(slot.timeMs)}`);
  };

  const markMissed = (e: SyntheticEvent) => {
    if (mark) void send({ ...base, type: "edit", targetTapId: mark.tapId, missed: true, deviceTimeMs: eventTimeMs(e) });
    else void send({ ...base, type: "edit", athleteId, missed: true, deviceTimeMs: eventTimeMs(e) });
    onDone(`${name}: missed at ${checkpoint.label}`);
  };

  const remove = (e: SyntheticEvent) => {
    if (!mark) return;
    void send({ ...base, type: "void", targetTapId: mark.tapId, deviceTimeMs: eventTimeMs(e) });
    onDone(`Deleted ${name}'s ${checkpoint.label} time`);
  };

  const list = (ids: string[], onPick: (e: SyntheticEvent, id: string) => void, empty: string) =>
    ids.length === 0 ? (
      <p className="text-sm text-green/60">{empty}</p>
    ) : (
      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto">
        {ids.map((id) => {
          const m = cp?.byAthlete.get(id);
          return (
            <button key={id} type="button" onClick={(e) => onPick(e, id)} className="rounded border-2 border-green px-2 py-2 text-left active:bg-gold-soft">
              <span className="block font-bold">{athletes[id]}</span>
              {m && !m.missed && <Time className="block text-xs text-green/60">{fmt(m.timeMs)}</Time>}
            </button>
          );
        })}
      </div>
    );

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-green/40" onClick={onClose}>
      <div className="w-full rounded-t-xl bg-cream p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <span className="text-lg font-bold">{name}</span>
            <span className="ml-2 text-sm text-green/70">{checkpoint.label}</span>
          </div>
          <Time className="text-xl font-bold">{mark ? (mark.missed ? "missed" : fmt(mark.timeMs)) : "—"}</Time>
        </div>
        {mark?.by && <p className="-mt-2 mb-3 text-xs text-green/60">recorded by {mark.by}</p>}
        {error && <p className="mb-2 text-sm text-red-700">{error}</p>}

        {mode === "menu" && mark && !mark.missed && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <Btn onClick={(e) => nudge(e, -1000)}>−1s</Btn>
              <Btn onClick={(e) => nudge(e, -500)}>−0.5s</Btn>
              <Btn onClick={(e) => nudge(e, 500)}>+0.5s</Btn>
              <Btn onClick={(e) => nudge(e, 1000)}>+1s</Btn>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Btn onClick={() => setMode("type")}>Type time</Btn>
              <Btn onClick={() => setMode("move")}>Move to…</Btn>
              <Btn onClick={() => setMode("swap")}>Swap with…</Btn>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={markMissed}>Mark missed</Btn>
              <Btn onClick={remove} danger>
                Delete
              </Btn>
            </div>
          </div>
        )}

        {mode === "menu" && (!mark || mark.missed) && (
          <div className="space-y-3">
            {cp && cp.pending.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-green/70">Use an unassigned capture</p>
                <div className="flex flex-wrap gap-2">
                  {cp.pending.map((s) => (
                    <Btn key={s.tapId} onClick={(e) => assignSlot(e, s)}>
                      <Time>{fmt(s.timeMs)}</Time>
                    </Btn>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => setMode("add")}>Add time</Btn>
              {!mark?.missed && <Btn onClick={markMissed}>Mark missed</Btn>}
              {mark?.missed && (
                <Btn onClick={remove} danger>
                  Clear missed
                </Btn>
              )}
            </div>
          </div>
        )}

        {(mode === "type" || mode === "add") && (
          <form onSubmit={saveTyped} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-green/70">
                {mode === "add" ? "Time" : "New time"} (elapsed, m:ss.t)
              </span>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={gunTimeMs ? "6:02.4" : "set the gun time first"}
                disabled={!gunTimeMs}
                inputMode="decimal"
                className="w-full rounded border border-green/40 bg-white px-3 py-3 font-mono text-xl tabular-nums"
              />
            </label>
            {mode === "add" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={estimate} onChange={(e) => setEstimate(e.target.checked)} className="size-5 accent-green" />
                This is an estimate
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="submit" disabled={!gunTimeMs} className="rounded bg-green px-3 py-3 text-sm font-bold uppercase tracking-wider text-cream disabled:opacity-40">
                Save
              </button>
              <Btn onClick={() => setMode("menu")}>Back</Btn>
            </div>
          </form>
        )}

        {mode === "move" && (
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-green/70">Move this time to</p>
            {list(withoutTime, moveTo, "Everyone else already has a time here; use Swap instead.")}
            <Btn onClick={() => setMode("menu")}>Back</Btn>
          </div>
        )}

        {mode === "swap" && (
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-green/70">Swap times with</p>
            {list(withTime, swapWith, "Nobody else has a time here yet.")}
            <Btn onClick={() => setMode("menu")}>Back</Btn>
          </div>
        )}

        {mode === "menu" && (
          <button type="button" onClick={onClose} className="mt-3 w-full py-2 text-sm text-green/70 underline">
            Close
          </button>
        )}
      </div>
    </div>
  );
}

function Btn({ onClick, children, danger }: { onClick: (e: SyntheticEvent) => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border-2 px-3 py-3 text-sm font-bold ${danger ? "border-red-700 text-red-700" : "border-green text-green"} active:bg-gold-soft`}
    >
      {children}
    </button>
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
