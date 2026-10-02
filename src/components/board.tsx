"use client";

import Link from "next/link";
import { type ReactNode, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppHeader, Badge, Button, Card, Checkbox, Field, Input, LinkButton, SectionLabel, Segmented, Sheet, Time, Toast } from "@/components/ui";
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
      <main className="p-6 text-sm text-ink-2">
        No races yet.{" "}
        <Link href={`/meets/${meetId}`} className="text-ink underline">
          Back to the meet
        </Link>
        .
      </main>
    );
  }

  return (
    <>
      <AppHeader back={{ href: `/meets/${meetId}`, label: "Meet" }} title="Live board" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">
        {races.length > 1 && (
          <Segmented value={race.id} onChange={setRaceId} options={races.map((r) => ({ value: r.id, label: r.name }))} className="mb-3 max-w-md" />
        )}
        <RaceBoard key={race.id} meetId={meetId} race={race} timeZone={timeZone} athletes={athletes} canFix={canFix} canTap={canTap} />
      </main>
    </>
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <RaceClock gunTimeMs={gunTimeMs} now={clock.now} />
        <div className="flex items-center gap-2">
          {!online && (
            <Badge tone="danger" dot>
              Offline
            </Badge>
          )}
          {canTap && (
            <LinkButton href={`/meets/${meetId}/tap?race=${race.id}`} size="sm" variant="secondary">
              Tap screen
            </LinkButton>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
              <th className="px-3 py-2 font-semibold sm:px-4">Athlete</th>
              {race.checkpoints.map((c) => (
                <th key={c.id} className="px-2 py-2 text-right font-semibold last:px-3 sm:last:px-4">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!loaded && (
              <tr>
                <td colSpan={race.checkpoints.length + 1} className="px-4 py-4 text-ink-3">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.athleteId} className={row.reached < 0 ? "text-ink-3" : ""}>
                <td className={`px-3 py-2 font-medium sm:px-4 ${row.reached < 0 ? "" : "text-ink"}`}>{athletes[row.athleteId]}</td>
                {row.marks.map((m, i) => {
                  const prevTime = i > 0 ? (row.marks[i - 1]?.timeMs ?? null) : gunTimeMs;
                  const split = m?.timeMs != null && prevTime != null ? m.timeMs - prevTime : null;
                  const last = i === row.marks.length - 1;
                  const cell = (
                    <>
                      <Time className={`block ${m?.missed ? "italic" : last && m ? "font-semibold" : ""}`}>
                        {m ? (m.missed ? "missed" : fmt(m.timeMs)) : "—"}
                        {m && !m.missed && (m.estimate ? "~" : m.edited ? "*" : "")}
                      </Time>
                      {split !== null && i > 0 && <Time className="block text-[11px] text-ink-3">+{formatElapsed(split)}</Time>}
                    </>
                  );
                  return (
                    <td key={race.checkpoints[i].id} className="px-1 py-1 text-right align-top last:pr-2 sm:last:pr-3">
                      {canFix ? (
                        <button
                          type="button"
                          onClick={() => setFix({ athleteId: row.athleteId, cpIndex: i })}
                          className="w-full rounded-md px-1.5 py-1 text-right hover:bg-surface-2 active:bg-gold-soft"
                        >
                          {cell}
                        </button>
                      ) : (
                        <span className="block px-1.5 py-1">{cell}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {pendingTotal > 0 && (
        <div className="mt-3">
          <Alert tone="gold" title={`${pendingTotal} unassigned capture${pendingTotal === 1 ? "" : "s"}`}>
            {race.checkpoints.map((c) => {
              const p = state.get(c.id)?.pending ?? [];
              return p.length ? (
                <div key={c.id} className="tnum">
                  {c.label}: {p.map((s) => fmt(s.timeMs)).join(", ")}
                </div>
              ) : null;
            })}
            {canFix && <div className="mt-1 text-xs">Tap an athlete&rsquo;s empty cell to give them one.</div>}
          </Alert>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-3">
        * edited &nbsp; ~ estimate &nbsp; Updates every few seconds.{canFix && " Tap a time to fix it."}
      </p>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-3">
          <Toast title={toast} />
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
      <p className="text-sm text-ink-2">{empty}</p>
    ) : (
      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto">
        {ids.map((id) => {
          const m = cp?.byAthlete.get(id);
          return (
            <button key={id} type="button" onClick={(e) => onPick(e, id)} className="rounded-lg border border-line bg-surface px-3 py-2 text-left hover:bg-surface-2 active:bg-gold-soft">
              <span className="block text-sm font-medium text-ink">{athletes[id]}</span>
              {m && !m.missed && <Time className="block text-xs text-ink-2">{fmt(m.timeMs)}</Time>}
            </button>
          );
        })}
      </div>
    );

  const timeLabel = mark ? (mark.missed ? "missed" : fmt(mark.timeMs)) : "no time";

  return (
    <Sheet
      title={name}
      subtitle={
        <>
          {checkpoint.label} · <Time>{timeLabel}</Time>
          {mark?.by && ` · recorded by ${mark.by}`}
        </>
      }
      onClose={onClose}
    >
      {error && (
        <div className="mb-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {mode === "menu" && mark && !mark.missed && (
        <div className="space-y-2">
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
              <SectionLabel className="mb-1.5">Use an unassigned capture</SectionLabel>
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
          <Field label={`${mode === "add" ? "Time" : "New time"} (elapsed, m:ss.t)`}>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={gunTimeMs ? "6:02.4" : "set the gun time first"}
              disabled={!gunTimeMs}
              inputMode="decimal"
              className="h-12 font-mono text-xl"
            />
          </Field>
          {mode === "add" && <Checkbox label="This is an estimate" checked={estimate} onChange={(e) => setEstimate(e.target.checked)} />}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setMode("menu")}>
              Back
            </Button>
            <Button type="submit" size="lg" disabled={!gunTimeMs}>
              Save
            </Button>
          </div>
        </form>
      )}

      {mode === "move" && (
        <div className="space-y-3">
          <SectionLabel>Move this time to</SectionLabel>
          {list(withoutTime, moveTo, "Everyone else already has a time here; use Swap instead.")}
          <Button variant="secondary" onClick={() => setMode("menu")} className="w-full">
            Back
          </Button>
        </div>
      )}

      {mode === "swap" && (
        <div className="space-y-3">
          <SectionLabel>Swap times with</SectionLabel>
          {list(withTime, swapWith, "Nobody else has a time here yet.")}
          <Button variant="secondary" onClick={() => setMode("menu")} className="w-full">
            Back
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function Btn({ onClick, children, danger }: { onClick: (e: SyntheticEvent) => void; children: ReactNode; danger?: boolean }) {
  return (
    <Button variant={danger ? "danger" : "secondary"} size="lg" onClick={onClick}>
      {children}
    </Button>
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
