"use client";

import { Lock, LockOpen, Pencil, Trophy } from "lucide-react";
import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { Button, Sheet } from "@/components/ui";
import type { TrackedTeam } from "@/lib/db/schema";
import { type CheckpointPlaces, ordinal, type OurTeam, type PlaceEntry, placeColor } from "@/lib/race-places";
import type { TapInput } from "@/lib/taps";

type Send = (input: Omit<TapInput, "clientTapId" | "deviceTimeMs" | "clockOffsetMs" | "raceId"> & { deviceTimeMs?: number }) => string;

/** On this phone: tap names (and teams), or only count places (a helper beside the name tapper). */
export type PlacesMode = "both" | "places";

/** A bounce, not two runners: taps on the same button closer than this are one. */
const BOUNCE_MS = 120;
const HOLD_MS = 500;
const PACK_GAP_MS = 10;
/** Our school's button and chips: the app's brand color. */
const US = { bg: "var(--color-brand)", ink: "var(--color-brand-ink)" };

/**
 * The place buttons on the record screen: one per tracked team, Other (everyone else; hold
 * for a pack of 2–5) and, on a places-only phone, our school. Below them the last few runners
 * counted here, each with its place; tap one to fix it.
 */
export function PlacesPad({
  mode,
  teams,
  ourTeam,
  checkpointId,
  places,
  athletes,
  send,
  eventTime,
  onPointer,
  onAction,
  onToast,
  onScores,
  locked,
  onLock,
}: {
  mode: PlacesMode;
  teams: TrackedTeam[];
  ourTeam: OurTeam;
  checkpointId: string;
  places: CheckpointPlaces | undefined;
  athletes: Record<string, string>;
  send: Send;
  /** When the finger landed (the record screen's pointer-down clock). */
  eventTime: (e: SyntheticEvent) => number;
  /** Notes when a finger lands, so the tap gets that moment rather than an earlier name tap's. */
  onPointer: () => void;
  /** For Undo: the taps this action sent, newest action wins. */
  onAction: (a: { tapIds: string[]; label: string }) => void;
  onToast: (text: string) => void;
  /** Opens the scores at this checkpoint. */
  onScores: () => void;
  /** Done counting at this checkpoint (remembered on this phone, so a reload doesn't unlock it). */
  locked: boolean;
  onLock: (locked: boolean) => void;
}) {
  // The last-tap pill flashes on each tap from this phone: a confirmation seen from the corner of the eye.
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashNow = () => {
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 450);
  };
  const [fixing, setFixing] = useState<{ entry: PlaceEntry; index: number } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [burst, setBurst] = useState<number | null>(null);
  const lastTap = useRef(new Map<string, number>());
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  // A new checkpoint starts with nothing open.
  const [seenCp, setSeenCp] = useState(checkpointId);
  if (seenCp !== checkpointId) {
    setSeenCp(checkpointId);
    setFixing(null);
    setBurst(null);
  }
  useEffect(() => {
    if (burst === null) return;
    const t = setTimeout(() => setBurst(null), 4000);
    return () => clearTimeout(t);
  }, [burst]);

  const base = { checkpointId, athleteId: null, targetTapId: null, timeMs: null, estimate: false, missed: false, note: null } as const;
  const label = (team: string) => (team === "us" ? ourTeam.short : team === "other" ? "Other" : (teams.find((t) => t.id === team)?.short ?? "?"));
  const entries = places?.entries ?? [];
  const counted = places ? (places.countingAll ? entries.length : entries.filter((e) => e.kind !== "other").length) : 0;

  const buzz = () => {
    try {
      navigator.vibrate?.(10);
    } catch {
      // not supported
    }
  };
  const tick = (e: SyntheticEvent, team: string) => {
    // The click that ends a hold on Other opened the pack buttons; it isn't a runner.
    if (team === "other" && held.current) {
      held.current = false;
      return;
    }
    const at = eventTime(e);
    if (at - (lastTap.current.get(team) ?? 0) < BOUNCE_MS) return;
    lastTap.current.set(team, at);
    const tapId = send({ ...base, type: "tick", team, deviceTimeMs: at });
    buzz();
    flashNow();
    onAction({ tapIds: [tapId], label: `${ordinal(counted + 1)} ${label(team)}` });
  };
  // A clump of untracked runners: n Others at once, a few ms apart so they keep their order.
  const pack = (e: SyntheticEvent, n: number) => {
    const at = eventTime(e);
    const tapIds = Array.from({ length: n }, (_, i) => send({ ...base, type: "tick", team: "other", deviceTimeMs: at + i * PACK_GAP_MS }));
    buzz();
    flashNow();
    setBurst(null);
    onAction({ tapIds, label: `${n} Others` });
    onToast(`Counted ${n} Others · ${ordinal(counted + 1)}–${ordinal(counted + n)}`);
  };
  const holdStart = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      held.current = true;
      setBurst(Date.now());
      buzz();
    }, HOLD_MS);
  };
  const holdEnd = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const big = mode === "places";
  // How many of each team have passed here: a missed tap shows up as a count that looks low.
  const countOf = (team: string) => entries.filter((e) => (e.kind === "us" ? "us" : e.kind === "other" ? "other" : e.teamId) === team).length;
  const button = (team: string, name: string, colors: { bg: string; ink: string }, extra = "") => (
    <button
      key={team}
      type="button"
      disabled={locked}
      onPointerDown={() => {
        onPointer();
        held.current = false;
        if (team === "other") holdStart();
      }}
      onPointerUp={team === "other" ? holdEnd : undefined}
      onPointerLeave={team === "other" ? holdEnd : undefined}
      onPointerCancel={team === "other" ? holdEnd : undefined}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => tick(e, team)}
      style={{ background: colors.bg, color: colors.ink, WebkitTouchCallout: "none" }}
      className={`relative flex flex-col items-center justify-center rounded-lg font-bold shadow-card select-none active:opacity-80 disabled:opacity-40 ${big ? "h-20 text-2xl" : "h-14 text-lg"} ${extra}`}
    >
      {countOf(team) > 0 && <span className="tnum absolute top-1 right-1.5 text-xs font-semibold opacity-80">{countOf(team)}</span>}
      {name}
      {team === "other" && <span className="text-[10px] font-medium opacity-75">hold for a pack</span>}
    </button>
  );

  const last = entries.at(-1) ?? null;
  const teamOf = (e: PlaceEntry) => (e.kind === "us" ? "us" : e.kind === "other" ? "other" : e.teamId);
  const colorsOf = (team: string) => (team === "us" ? US : team === "other" ? null : placeColor(teams.find((t) => t.id === team)?.color ?? "gray"));
  const textOf = (e: PlaceEntry) => (e.kind === "us" && e.athleteId ? `${ourTeam.short} · ${(athletes[e.athleteId] ?? "?").split(" ")[0]}` : label(teamOf(e)));
  const lastColors = last ? colorsOf(teamOf(last)) : null;

  return (
    <div className="px-3 pt-2">
      {/* One fixed line: the last tap first (what you just did), the running count, then Fix, Scores and Done. Never scrolls, never changes height. */}
      <div className="relative mb-2 flex h-9 items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {locked ? (
            <span className="truncate text-sm font-medium text-ink">Done · {counted} counted</span>
          ) : last ? (
            <>
              <span
                style={lastColors ? { background: lastColors.bg, color: lastColors.ink } : undefined}
                className={`flex h-8 min-w-0 items-center truncate rounded-md px-2.5 text-sm font-bold transition-transform duration-150 ${lastColors ? "" : "border border-line-strong bg-surface text-ink"} ${flash ? "scale-105 ring-4 ring-brand/50" : ""}`}
              >
                <span className="tnum mr-1.5 opacity-80">{ordinal(entries.length)}</span>
                <span className="truncate">{textOf(last)}</span>
              </span>
              <span className="shrink-0 text-xs text-ink-3">
                next <span className="tnum font-semibold text-ink-2">{ordinal(counted + 1)}</span>
                {places && !places.countingAll && "*"}
              </span>
            </>
          ) : (
            <span className="truncate text-sm text-ink-3">Waiting for the first runner</span>
          )}
        </div>
        {entries.some((e) => e.tapId) && (
          <Button variant="secondary" size="sm" onClick={() => setListOpen(true)} className="h-8 shrink-0 px-2">
            <Pencil className="size-3.5" />
            Fix
          </Button>
        )}
        {places && (
          <Button variant="secondary" size="sm" onClick={onScores} className="h-8 shrink-0 px-2">
            <Trophy className="size-3.5" />
            Scores
          </Button>
        )}
        <Button variant={locked ? "primary" : "secondary"} size="sm" onClick={() => onLock(!locked)} aria-label={locked ? "Count again" : "Done counting"} className="h-8 shrink-0 px-2">
          {locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
          {locked ? "Count again" : "Done"}
        </Button>
        {/* Over the row, not above the buttons, so the buttons never move under a thumb. */}
        {burst !== null && !locked && (
          <div className="absolute inset-x-0 bottom-0 z-10 grid grid-cols-4 gap-1.5 bg-bg">
            {[2, 3, 4, 5].map((n) => (
              <Button key={n} variant="secondary" onPointerDown={onPointer} onClick={(e) => pack(e, n)} className="h-12 text-base font-bold">
                +{n} Other
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className={`grid gap-1.5 ${big ? "grid-cols-2" : teams.length + 1 <= 3 ? "grid-cols-3" : "grid-cols-4"}`}>
        {big && button("us", ourTeam.name, US, "col-span-2 h-24!")}
        {teams.map((t) => button(t.id, t.short, placeColor(t.color)))}
        {button("other", "Other", { bg: "var(--color-ink)", ink: "var(--color-bg)" }, big && teams.length % 2 === 0 ? "col-span-2" : "")}
      </div>

      {listOpen && !fixing && (
        <Sheet title="Fix a place" subtitle={`${entries.length} counted here. Newest first; tap one to fix it.`} onClose={() => setListOpen(false)}>
          <ul className="max-h-[60dvh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {entries
              .map((entry, index) => ({ entry, index }))
              .slice(-30)
              .reverse()
              .map(({ entry, index }) => {
                const c = colorsOf(teamOf(entry));
                return (
                  <li key={entry.tapId ?? `name-${index}`}>
                    <button
                      type="button"
                      disabled={!entry.tapId}
                      onClick={() => setFixing({ entry, index })}
                      className="flex h-12 w-full items-center gap-3 px-3 text-left hover:bg-surface-2 disabled:hover:bg-transparent"
                    >
                      <span className="tnum w-12 shrink-0 text-sm font-semibold text-ink">{ordinal(index + 1)}</span>
                      <span style={c ? { background: c.bg, color: c.ink } : undefined} className={`rounded px-2 py-0.5 text-sm font-semibold ${c ? "" : "border border-line-strong text-ink"}`}>
                        {teamOf(entry) === "us" ? ourTeam.short : label(teamOf(entry))}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
                        {entry.kind === "us" && entry.athleteId ? (athletes[entry.athleteId] ?? "?") : ""}
                        {!entry.tapId && <span className="text-ink-3"> · name tap, fix on Live results</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </Sheet>
      )}

      {fixing && (
        <FixPlaceSheet
          entry={fixing.entry}
          place={fixing.index + 1}
          ourTeam={ourTeam}
          before={fixing.index > 0 ? entries[fixing.index - 1] : null}
          beforeThat={fixing.index > 1 ? entries[fixing.index - 2] : null}
          teams={teams}
          canUs={mode === "places" || fixing.entry.kind === "us"}
          label={label}
          onClose={() => setFixing(null)}
          onSend={(input, toast) => {
            const tapId = send({ ...base, ...input });
            onAction({ tapIds: [tapId], label: toast });
            onToast(toast);
            setFixing(null);
          }}
        />
      )}
    </div>
  );
}

/** One counted runner: who it really was, swapped with the one ahead, someone missed just before, or not a runner at all. */
function FixPlaceSheet({
  entry,
  place,
  ourTeam,
  before,
  beforeThat,
  teams,
  canUs,
  label,
  onClose,
  onSend,
}: {
  entry: PlaceEntry;
  place: number;
  ourTeam: OurTeam;
  before: PlaceEntry | null;
  beforeThat: PlaceEntry | null;
  teams: TrackedTeam[];
  canUs: boolean;
  label: (team: string) => string;
  onClose: () => void;
  onSend: (input: Partial<Omit<TapInput, "clientTapId" | "deviceTimeMs" | "clockOffsetMs" | "raceId">> & Pick<TapInput, "type">, toast: string) => void;
}) {
  const tapId = entry.tapId!;
  const current = entry.kind === "us" ? "us" : entry.kind === "other" ? "other" : entry.teamId;
  const choices = [...(canUs ? ["us"] : []), ...teams.map((t) => t.id), "other"];
  const [adding, setAdding] = useState(false);
  // A time between two counted runners (never on top of either), so the order is certain.
  const between = (a: PlaceEntry | null, b: PlaceEntry) => (a ? Math.floor((a.timeMs + b.timeMs) / 2) : b.timeMs - 1000);
  return (
    <Sheet title={`${ordinal(place)} · ${label(current)}`} subtitle="Fix this place. Everyone behind it moves with it." onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink">{adding ? `Who was missed just before ${ordinal(place)}?` : "It was really…"}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {choices
              .filter((c) => adding || c !== current)
              .map((c) => (
                <Button
                  key={c}
                  variant="secondary"
                  className="h-12 font-semibold"
                  onClick={() =>
                    adding
                      ? onSend({ type: "tick", team: c, timeMs: between(before, entry) }, `Added ${label(c)} at ${ordinal(place)}`)
                      : onSend({ type: "edit", targetTapId: tapId, team: c }, `${ordinal(place)} is ${label(c)}`)
                  }
                >
                  {label(c)}
                </Button>
              ))}
          </div>
        </div>
        <div className="grid gap-2">
          {!adding && (
            <Button variant="secondary" size="lg" onClick={() => setAdding(true)}>
              Someone was missed just before this
            </Button>
          )}
          {before && !adding && (
            <Button variant="secondary" size="lg" onClick={() => onSend({ type: "edit", targetTapId: tapId, timeMs: between(beforeThat, before) }, `Swapped ${ordinal(place - 1)} and ${ordinal(place)}`)}>
              Swap with {ordinal(place - 1)} ({before.kind === "us" ? ourTeam.short : label(before.kind === "other" ? "other" : before.teamId)})
            </Button>
          )}
          {!adding && (
            <Button variant="danger" size="lg" onClick={() => onSend({ type: "void", targetTapId: tapId }, `Removed ${ordinal(place)}`)}>
              Not a runner · remove
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
