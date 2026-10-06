"use client";

import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeftRight, Check, Pencil, Undo2, X } from "lucide-react";
import { ClockWarning } from "@/components/race-card";
import { CheckpointCounts, RaceStatusBar } from "@/components/race-status";
import { SessionMenu } from "@/components/session-menu";
import { AppHeader, Badge, Button, LinkButton, SectionLabel, Segmented, Sheet, Time, Toast, RaceStateBadge } from "@/components/ui";
import { useClock } from "@/lib/client/clock";
import { useRaceTaps } from "@/lib/client/use-race-taps";
import { useWakeLock } from "@/lib/client/use-wake-lock";
import { type Mark, replay, type Slot, type SlotWithNames, type TapLike } from "@/lib/replay";
import { formatClock, formatElapsed } from "@/lib/time";

type RaceInfo = {
  id: string;
  name: string;
  gunTimeMs: number | null;
  finished: boolean;
  checkpoints: { id: string; label: string; kind: "split" | "finish" }[];
  athleteIds: string[];
};

type Props = {
  meetId: string;
  meetName: string;
  session: { name: string; role: string };
  initial: { raceId: string | null; checkpointId: string | null };
  timeZone: string;
  races: RaceInfo[];
  athletes: Record<string, string>;
};

const DOUBLE_TAP_MS = 1000;
/** A capture stays open for more names this long after it was taken (a pack crossing together). */
const CAPTURE_OPEN_MS = 20_000;
/** How long a capture chip stays in the bottom bar after it was taken. */
const CHIP_TTL_MS = 3 * 60_000;
const INTRO_KEY = "ls_record_intro_seen";
const introListeners = new Set<() => void>();
const subscribeIntro = (l: () => void) => {
  introListeners.add(l);
  return () => {
    introListeners.delete(l);
  };
};
const readIntroSeen = () => {
  try {
    return localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return true;
  }
};
const TOAST_MS = 4000;
const FLASH_MS = 400;

/**
 * When the tap happened, as epoch ms. Date.now() in the handler is within a
 * frame of the touch; the event's performance-clock timestamp is not used
 * because iOS pauses that clock while the phone sleeps.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const eventTimeMs = (_e: SyntheticEvent) => Date.now();

export function TapScreen({ meetId, meetName, session, initial, timeZone, races, athletes }: Props) {
  useWakeLock();
  // Selection lives in the URL (?race=&cp=) so a reload lands on the same checkpoint.
  const [sel, setSel] = useState(() => {
    const r = races.find((x) => x.id === initial.raceId) ?? races.find((x) => !x.finished) ?? races[0];
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
      meetName={meetName}
      session={session}
      timeZone={timeZone}
      race={race}
      cpIndex={cpIndex}
      athletes={athletes}
      pickerFor={(current) => <SwitchControl races={races} race={race} checkpointId={race.checkpoints[cpIndex].id} current={current} onSwitch={setSel} />}
    />
  );
}

/**
 * Where taps go. Changing it is deliberate: open the sheet, pick, confirm.
 * A stray tap on a segmented control was too easy to make mid-race.
 */
type RaceSummary = { counts: Record<string, number>; gunTimeMs: number | null };

function SwitchControl({
  races,
  race,
  checkpointId,
  current,
  onSwitch,
}: {
  races: RaceInfo[];
  race: RaceInfo;
  checkpointId: string;
  /** Live numbers for the race we're on; other races are fetched when picked. */
  current: RaceSummary;
  onSwitch: (sel: { raceId: string; checkpointId: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState({ raceId: race.id, checkpointId });
  const [fetched, setFetched] = useState<Record<string, RaceSummary>>({});
  const pickedRace = races.find((r) => r.id === pick.raceId) ?? race;
  const pickedCp = pickedRace.checkpoints.find((c) => c.id === pick.checkpointId) ?? pickedRace.checkpoints[0];
  const changed = pick.raceId !== race.id || pick.checkpointId !== checkpointId;
  const summary: RaceSummary | null = pickedRace.id === race.id ? current : (fetched[pickedRace.id] ?? null);

  // Another race's numbers: one fetch of its log, replayed here.
  useEffect(() => {
    if (!open || pickedRace.id === race.id || fetched[pickedRace.id]) return;
    let cancelled = false;
    fetch(`/api/races/${pickedRace.id}/taps`, { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { taps: TapLike[]; gunTimeMs: number | null }) => {
        if (cancelled) return;
        const st = replay({ checkpoints: pickedRace.checkpoints.map((c) => ({ ...c, distance: { value: 0, unit: "mi", meters: 0 }, kind: "split" })) }, body.taps);
        const counts = Object.fromEntries(pickedRace.checkpoints.map((c) => [c.id, [...(st.get(c.id)?.byAthlete.values() ?? [])].filter((m) => !m.missed).length]));
        setFetched((f) => ({ ...f, [pickedRace.id]: { counts, gunTimeMs: body.gunTimeMs } }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, pickedRace, race.id, fetched]);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setPick({ raceId: race.id, checkpointId });
          setOpen(true);
        }}
      >
        <ArrowLeftRight className="size-3.5" />
        Change
      </Button>
      {open && (
        <Sheet title="Where are you recording?" subtitle="Taps go to the race and checkpoint you pick here." onClose={() => setOpen(false)}>
          <div className="space-y-4">
            {races.length > 1 && (
              <div>
                <SectionLabel className="mb-1.5">Race</SectionLabel>
                <Segmented
                  value={pick.raceId}
                  onChange={(id) => {
                    const r = races.find((x) => x.id === id)!;
                    setPick({ raceId: r.id, checkpointId: r.checkpoints[0]?.id ?? "" });
                  }}
                  options={races.map((r) => ({ value: r.id, label: r.finished ? `${r.name} (finished)` : r.name }))}
                />
              </div>
            )}
            <div className="flex items-center gap-2 text-[13px] text-ink-2">
              <span className="font-medium text-ink">{pickedRace.name}</span>
              {summary === null && !pickedRace.finished ? (
                <span>loading…</span>
              ) : (
                <RaceStateBadge state={pickedRace.finished ? "finished" : summary?.gunTimeMs ? "in_progress" : "not_started"} />
              )}
              <span>· {pickedRace.athleteIds.length} athletes</span>
            </div>
            <div>
              <SectionLabel className="mb-1.5">Checkpoint</SectionLabel>
              <div className="grid gap-2">
                {pickedRace.checkpoints.map((c) => {
                  const active = c.id === pick.checkpointId;
                  const n = summary?.counts[c.id];
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setPick({ raceId: pickedRace.id, checkpointId: c.id })}
                      className={`flex h-12 items-center justify-between rounded-lg border px-4 text-left text-base font-medium ${
                        active ? "border-brand bg-brand-soft text-ink" : "border-line bg-surface text-ink hover:bg-surface-2"
                      }`}
                    >
                      <span>{c.label}</span>
                      <span className="flex items-center gap-2 text-[13px] font-normal text-ink-2">
                        {n !== undefined && (
                          <span className="tnum">
                            {n} of {pickedRace.athleteIds.length} recorded
                          </span>
                        )}
                        {active && <Check className="size-4 text-brand-text" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <Button
              size="lg"
              disabled={!changed}
              onClick={() => {
                onSwitch(pick);
                setOpen(false);
              }}
              className="w-full"
            >
              {changed ? `Record at ${pickedCp?.label ?? ""} · ${pickedRace.name}` : `Already at ${pickedCp?.label ?? ""} · ${pickedRace.name}`}
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}

type LastAction = {
  tapId: string;
  label: string;
  /** Set when the action replaced an earlier time, so undo can put it back. */
  restore?: { athleteId: string; timeMs: number; estimate: boolean; fromSlotId: string | null };
};

function RaceTapper({
  meetId,
  meetName,
  session,
  timeZone,
  race,
  cpIndex,
  athletes,
  pickerFor,
}: {
  meetId: string;
  meetName: string;
  session: { name: string; role: string };
  timeZone: string;
  race: RaceInfo;
  cpIndex: number;
  athletes: Record<string, string>;
  pickerFor: (current: RaceSummary) => React.ReactNode;
}) {
  const clock = useClock();
  const checkpoint = race.checkpoints[cpIndex];
  const { taps, gunTimeMs, official, finished, staleMinutes, send, online, signedOut, rejected, loaded, unsent } = useRaceTaps(race.id, race.gunTimeMs);
  const isFinished = race.finished || finished;
  const officialAt = (athleteId: string): number | null => {
    const o = official[athleteId];
    if (!o) return null;
    return o.byCheckpoint[checkpoint.id] ?? (checkpoint.kind === "finish" ? o.finishMs : null);
  };
  const state = useMemo(
    () => replay({ checkpoints: race.checkpoints.map((c) => ({ ...c, distance: { value: 0, unit: "mi", meters: 0 }, kind: "split" })) }, taps),
    [race, taps],
  );
  const cp = state.get(checkpoint.id);
  const prev = cpIndex > 0 ? state.get(race.checkpoints[cpIndex - 1].id) : undefined;
  const counts = race.checkpoints.map((c) => ({
    id: c.id,
    label: c.label,
    n: race.athleteIds.filter((id) => {
      const o = official[id];
      const hasOfficial = o ? (o.byCheckpoint[c.id] ?? (c.kind === "finish" ? o.finishMs : null)) !== null : false;
      const m = state.get(c.id)?.byAthlete.get(id);
      return hasOfficial || (!!m && !m.missed);
    }).length,
  }));

  // Grid order: by the previous checkpoint's order; athletes not yet seen there go last, by name.
  const ordered = useMemo(() => {
    const prevTime = (id: string) => prev?.byAthlete.get(id)?.timeMs ?? Number.POSITIVE_INFINITY;
    return [...race.athleteIds].sort((a, b) => prevTime(a) - prevTime(b) || (athletes[a] ?? "").localeCompare(athletes[b] ?? ""));
  }, [race, prev, athletes]);

  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  // Coarse clock for chip expiry; ticks every few seconds rather than reading the clock during render.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  // First-use card: read from localStorage after hydration (the server never shows it).
  const introSeen = useSyncExternalStore(subscribeIntro, readIntroSeen, () => true);
  const dismissIntro = () => {
    try {
      localStorage.setItem(INTRO_KEY, "1");
    } catch {
      // ignore
    }
    introListeners.forEach((l) => l());
  };
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
    setSelectedSlotId(null);
    void send({ ...base, type: "capture", deviceTimeMs }).then((tapId) => setLastAction({ tapId, label: "capture" }));
    flash("capture");
    showToast(`Captured ${fmt(deviceTimeMs + offset)}`);
  };

  const record = (e: SyntheticEvent, athleteId: string, replacing: Mark | null) => {
    const deviceTimeMs = eventTimeMs(e);
    setConfirmId(null);
    if (replacing) void send({ ...base, type: "void", targetTapId: replacing.tapId, deviceTimeMs });
    // Which capture (if any) this name belongs to: a chip the manager picked, else the
    // oldest empty one, else a recent one a pack is still filling, else none (record now).
    const selected = selectedSlotId ? cp?.slots.find((x) => x.tapId === selectedSlotId) : undefined;
    const newest = cp?.slots.at(-1);
    const slot: Slot | undefined =
      selected ?? cp?.pending[0] ?? (newest && deviceTimeMs + offset - newest.timeMs < CAPTURE_OPEN_MS ? newest : undefined);
    const promise = slot
      ? send({ ...base, type: "assign", athleteId, targetTapId: slot.tapId, deviceTimeMs })
      : send({ ...base, type: "name_tap", athleteId, deviceTimeMs });
    const restore =
      replacing && replacing.timeMs !== null
        ? { athleteId, timeMs: replacing.timeMs, estimate: replacing.estimate, fromSlotId: replacing.fromSlotId }
        : undefined;
    void promise.then((tapId) => setLastAction({ tapId, label: athletes[athleteId] ?? "tap", restore }));
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
    const t = eventTimeMs(e);
    void send({ ...base, type: "void", targetTapId: lastAction.tapId, deviceTimeMs: t });
    if (lastAction.restore) {
      // The replaced time was voided; give it back. A time that came from a capture is
      // re-assigned from that capture (which the replace had released to pending).
      const { athleteId, timeMs, estimate, fromSlotId } = lastAction.restore;
      if (fromSlotId) void send({ ...base, type: "assign", athleteId, targetTapId: fromSlotId, deviceTimeMs: t + 1 });
      else void send({ ...base, type: "name_tap", athleteId, timeMs, estimate, deviceTimeMs: t + 1 });
      showToast(`Undid replace · ${athletes[athleteId]} back to ${fmt(timeMs)}`);
    } else {
      showToast(`Undid ${lastAction.label}`);
    }
    setLastAction(null);
  };

  const deleteSlot = (e: SyntheticEvent, slot: Slot) => {
    void send({ ...base, type: "void", targetTapId: slot.tapId, deviceTimeMs: eventTimeMs(e) });
    if (lastAction?.tapId === slot.tapId) setLastAction(null);
    showToast(`Deleted ${fmt(slot.timeMs)}`);
  };

  return (
    <main className="flex min-h-dvh flex-col bg-bg">
      <AppHeader
        title={meetName}
        titleHref={`/meets/${meetId}`}
        subtitle="Record splits"
        right={
          <>
            <LinkButton href={`/meets/${meetId}/board?race=${race.id}`} variant="secondary" size="sm">
              Live board
            </LinkButton>
            <SessionMenu name={session.name} role={session.role} />
          </>
        }
      />
      <div className="sticky top-14 z-10 space-y-2 border-b border-line bg-bg/95 px-3 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <RaceStatusBar name={race.name} finished={isFinished} gunTimeMs={gunTimeMs} now={clock.now} />
          <ClockWarning sync={clock.sync} error={clock.error} />
          {signedOut ? (
            <Link href="/join">
              <Badge tone="danger" dot>
                Signed out · rejoin
              </Badge>
            </Link>
          ) : (
            !online && (
              <Badge tone="danger" dot>
                Offline
              </Badge>
            )
          )}
          {unsent > 0 && <Badge tone="gold">{unsent} unsent</Badge>}
          {staleMinutes > 0 && <Badge tone="gold">updated {staleMinutes} min ago</Badge>}
          {rejected > 0 && (
            <Badge tone="danger" dot>
              {rejected} rejected
            </Badge>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-2xl font-semibold tracking-tight text-ink">{checkpoint.label}</div>
          {pickerFor({
            gunTimeMs,
            counts: Object.fromEntries(counts.map((c) => [c.id, c.n])),
          })}
        </div>
        <CheckpointCounts counts={counts} total={race.athleteIds.length} loaded={loaded} finished={isFinished} activeId={checkpoint.id} />
      </div>

      {!introSeen && (
        <div className="mx-3 mt-3 rounded-lg border border-brand/30 bg-brand-soft p-3 text-sm text-ink">
          <p className="font-semibold">How to record splits</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
            <li>Tap a runner&rsquo;s name the moment they pass. That records their time.</li>
            <li>Can&rsquo;t name them fast enough? Tap <b>Capture time</b> as they pass, then tap the names after. One capture can take a whole pack.</li>
            <li>Wrong name? <b>Undo</b> takes back the last tap.</li>
          </ul>
          <Button size="sm" onClick={dismissIntro} className="mt-2">
            Got it
          </Button>
        </div>
      )}
      <p className="px-3 pt-3 text-center text-[13px] text-ink-2">Tap a runner as they pass.</p>
      <div className="grid flex-1 grid-cols-2 content-start gap-2 p-3 pb-44">
        {!loaded && <p className="col-span-2 text-sm text-ink-3">Loading…</p>}
        {ordered.map((id) => {
          const mark = cp?.byAthlete.get(id);
          const name = athletes[id] ?? "?";
          const [first, ...rest] = name.split(" ");
          const off = officialAt(id);
          if (off !== null) {
            return (
              <div key={id} className="min-h-20 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left text-ink-3">
                <span className="block truncate text-xl leading-tight font-semibold">{first}</span>
                <span className="block truncate text-sm">{rest.join(" ")}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-sm">
                  <Time className="font-semibold text-ink-2">{formatElapsed(off)}</Time>
                  <Badge tone="brand">official</Badge>
                </span>
              </div>
            );
          }
          const done = !!mark && !mark.missed;
          if (confirmId === id) {
            return (
              <div key={id} className="flex min-h-20 flex-col justify-center rounded-lg border-2 border-brand bg-surface p-2 text-center shadow-card">
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
                  ? "border-brand bg-brand text-brand-ink"
                  : done
                    ? "border-line bg-surface-2 text-ink-3"
                    : "border-line bg-surface text-ink shadow-card active:bg-brand-soft"
              }`}
            >
              <span className="block truncate text-xl leading-tight font-semibold">{first}</span>
              <span className={`block truncate text-sm ${done || flashId === id ? "" : "text-ink-2"}`}>{rest.join(" ")}</span>
              {mark && (
                <span className="mt-0.5 flex items-center gap-1 text-sm">
                  <Time className={mark.missed ? "italic" : "font-semibold text-ink-2"}>
                    {mark.missed ? "missed" : fmt(mark.timeMs)}
                    {mark.estimate && !mark.missed && " ~"}
                  </Time>
                  <Pencil className="size-3 text-ink-3" aria-hidden />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-36 z-20 flex justify-center px-3">
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

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <CaptureChips
          slots={cp?.slots ?? []}
          selectedId={selectedSlotId}
          now={nowMs}
          athletes={athletes}
          fmt={fmt}
          onSelect={(id) => setSelectedSlotId((cur) => (cur === id ? null : id))}
          onDelete={deleteSlot}
        />
        <div className="flex gap-2 px-3 pt-2">
          <Button variant="secondary" size="lg" onClick={undo} disabled={!lastAction} className="h-16 w-20 flex-col gap-0.5 px-0">
            <Undo2 className="size-6 shrink-0" />
            <span className="text-xs">Undo</span>
          </Button>
          <button
            type="button"
            onClick={capture}
            className={`flex h-16 flex-1 flex-col items-center justify-center rounded-lg shadow-card select-none ${
              flashId === "capture" ? "bg-brand text-brand-ink" : "bg-ink text-bg active:bg-ink/80"
            }`}
          >
            <span className="text-xl leading-tight font-semibold tracking-wide">
              Capture time{cp && cp.pending.length > 0 ? ` · ${cp.pending.length} waiting` : ""}
            </span>
            <span className="text-xs opacity-70">then tap the names</span>
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * Recent captures, in the bottom bar where the thumb is. Empty ones are the
 * ones waiting for a name; tapping a chip makes it the target for the next names.
 */
function CaptureChips({
  slots,
  selectedId,
  now,
  athletes,
  fmt,
  onSelect,
  onDelete,
}: {
  slots: SlotWithNames[];
  selectedId: string | null;
  now: number;
  athletes: Record<string, string>;
  fmt: (ms: number | null) => string;
  onSelect: (id: string) => void;
  onDelete: (e: SyntheticEvent, slot: Slot) => void;
}) {
  const shown = slots.filter((s) => s.athleteIds.length === 0 || now === 0 || now - s.timeMs < CHIP_TTL_MS);
  if (shown.length === 0) return null;
  const firstName = (id: string) => (athletes[id] ?? "?").split(" ")[0];
  return (
    <div className="flex gap-1.5 overflow-x-auto px-3 pt-2 pb-0.5">
      {shown.map((s) => {
        const empty = s.athleteIds.length === 0;
        const selected = s.tapId === selectedId;
        return (
          <span
            key={s.tapId}
            className={`flex shrink-0 items-center gap-1 rounded-md py-1 pl-2 text-sm ${
              selected ? "bg-brand text-brand-ink" : empty ? "bg-brand-soft text-ink ring-2 ring-brand" : "border border-line bg-surface text-ink-2"
            }`}
          >
            <button type="button" onClick={() => onSelect(s.tapId)} className="flex items-center gap-1.5">
              <Time className="font-semibold">{fmt(s.timeMs)}</Time>
              <span className="text-xs">{empty ? "waiting" : s.athleteIds.map(firstName).join(", ")}</span>
            </button>
            {empty ? (
              <button type="button" onClick={(e) => onDelete(e, s)} aria-label="Delete this capture" className="rounded p-1 text-ink-3 hover:text-danger">
                <X className="size-3.5" />
              </button>
            ) : (
              <span className="w-1.5" />
            )}
          </span>
        );
      })}
    </div>
  );
}
