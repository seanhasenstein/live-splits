"use client";

import { Lock, LockOpen } from "lucide-react";
import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { Button, Sheet } from "@/components/ui";
import type { TrackedTeam } from "@/lib/db/schema";
import { type CheckpointPlaces, ordinal, type PlaceEntry, placeColor } from "@/lib/race-places";
import type { TapInput } from "@/lib/taps";

type Send = (input: Omit<TapInput, "clientTapId" | "deviceTimeMs" | "clockOffsetMs" | "raceId"> & { deviceTimeMs?: number }) => string;

/** On this phone: tap names (and teams), or only count places (a helper beside the name tapper). */
export type PlacesMode = "both" | "places";

/** A bounce, not two runners: taps on the same button closer than this are one. */
const BOUNCE_MS = 120;
const HOLD_MS = 500;
const US = { short: "US", bg: "var(--color-brand)", ink: "var(--color-brand-ink)" };

/**
 * The place buttons on the record screen: one per tracked team, Other (everyone else; hold
 * for a pack of 2–5) and, on a places-only phone, Us. Below them the last few runners
 * counted here, each with its place; tap one to fix it.
 */
export function PlacesPad({
  mode,
  teams,
  checkpointId,
  places,
  athletes,
  send,
  eventTime,
  onAction,
  onToast,
}: {
  mode: PlacesMode;
  teams: TrackedTeam[];
  checkpointId: string;
  places: CheckpointPlaces | undefined;
  athletes: Record<string, string>;
  send: Send;
  /** When the finger landed (the record screen's pointer-down clock). */
  eventTime: (e: SyntheticEvent) => number;
  /** For Undo: the taps this action sent, newest action wins. */
  onAction: (a: { tapIds: string[]; label: string }) => void;
  onToast: (text: string) => void;
}) {
  const [locked, setLocked] = useState(false);
  const [fixing, setFixing] = useState<{ entry: PlaceEntry; index: number } | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  const lastTap = useRef(new Map<string, number>());
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  // A new checkpoint starts unlocked, with nothing open.
  const [seenCp, setSeenCp] = useState(checkpointId);
  if (seenCp !== checkpointId) {
    setSeenCp(checkpointId);
    setLocked(false);
    setFixing(null);
    setBurst(null);
  }
  useEffect(() => {
    if (burst === null) return;
    const t = setTimeout(() => setBurst(null), 4000);
    return () => clearTimeout(t);
  }, [burst]);

  const base = { checkpointId, athleteId: null, targetTapId: null, timeMs: null, estimate: false, missed: false, note: null } as const;
  const label = (team: string) => (team === "us" ? "Us" : team === "other" ? "Other" : (teams.find((t) => t.id === team)?.short ?? "?"));
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
    if (held.current) {
      held.current = false;
      return;
    }
    const at = eventTime(e);
    if (at - (lastTap.current.get(team) ?? 0) < BOUNCE_MS) return;
    lastTap.current.set(team, at);
    const tapId = send({ ...base, type: "tick", team, deviceTimeMs: at });
    buzz();
    onAction({ tapIds: [tapId], label: `${label(team)} · ${ordinal(counted + 1)}` });
  };
  // A clump of untracked runners: n Others at once, a millisecond apart so they keep their order.
  const pack = (e: SyntheticEvent, n: number) => {
    const at = eventTime(e);
    const tapIds = Array.from({ length: n }, (_, i) => send({ ...base, type: "tick", team: "other", deviceTimeMs: at + i }));
    buzz();
    setBurst(null);
    onAction({ tapIds, label: `${n} Others` });
    onToast(`Counted ${n} Others · ${ordinal(counted + 1)}–${ordinal(counted + n)}`);
  };
  const holdStart = () => {
    held.current = false;
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
  const button = (team: string, name: string, colors: { bg: string; ink: string }, extra = "") => (
    <button
      key={team}
      type="button"
      disabled={locked}
      onPointerDown={team === "other" ? holdStart : undefined}
      onPointerUp={team === "other" ? holdEnd : undefined}
      onPointerLeave={team === "other" ? holdEnd : undefined}
      onPointerCancel={team === "other" ? holdEnd : undefined}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => tick(e, team)}
      style={{ background: colors.bg, color: colors.ink, WebkitTouchCallout: "none" }}
      className={`flex flex-col items-center justify-center rounded-lg font-bold shadow-card select-none active:opacity-80 disabled:opacity-40 ${big ? "h-20 text-2xl" : "h-14 text-lg"} ${extra}`}
    >
      {name}
      {team === "other" && <span className="text-[10px] font-medium opacity-75">hold for a pack</span>}
    </button>
  );

  const shown = entries.slice(-6);
  const offset = entries.length - shown.length;

  return (
    <div className="px-3 pt-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-ink-2">
        <span>
          {locked ? (
            <span className="font-medium text-ink">Done counting · {counted} counted</span>
          ) : (
            <>
              Next: <span className="tnum text-base font-semibold text-ink">{ordinal(counted + 1)}</span>
              {places && !places.countingAll && <span className="text-ink-3"> among tracked teams</span>}
            </>
          )}
        </span>
        <button type="button" onClick={() => setLocked((v) => !v)} className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-ink-2 hover:bg-surface-2">
          {locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
          {locked ? "Count again" : "Done counting"}
        </button>
      </div>

      {shown.length > 0 && (
        <div className="mb-2 flex gap-1 overflow-x-auto">
          {shown.map((entry, i) => {
            const index = offset + i;
            const team = entry.kind === "us" ? "us" : entry.kind === "other" ? "other" : entry.teamId;
            const c = team === "us" ? US : team === "other" ? null : placeColor(teams.find((t) => t.id === team)?.color ?? "gray");
            const fixable = entry.tapId !== null;
            const text = entry.kind === "us" && entry.athleteId ? (athletes[entry.athleteId] ?? "?").split(" ")[0] : label(team);
            return (
              <button
                key={entry.tapId ?? `${entry.kind}-${index}`}
                type="button"
                disabled={!fixable}
                onClick={() => setFixing({ entry, index })}
                style={c ? { background: c.bg, color: c.ink } : undefined}
                className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${c ? "" : "border border-line-strong bg-surface text-ink"}`}
              >
                <span className="tnum opacity-75">{ordinal(index + 1)}</span>
                {text}
              </button>
            );
          })}
        </div>
      )}

      {burst !== null && !locked && (
        <div className="mb-2 grid grid-cols-4 gap-1.5">
          {[2, 3, 4, 5].map((n) => (
            <Button key={n} variant="secondary" onClick={(e) => pack(e, n)} className="h-12 text-base font-bold">
              +{n} Other
            </Button>
          ))}
        </div>
      )}

      <div className={`grid gap-1.5 ${big ? "grid-cols-2" : teams.length + 1 <= 3 ? "grid-cols-3" : "grid-cols-4"}`}>
        {big && button("us", "Us", US, "col-span-2 h-24!")}
        {teams.map((t) => button(t.id, t.short, placeColor(t.color)))}
        {button("other", "Other", { bg: "var(--color-ink)", ink: "var(--color-bg)" }, big && teams.length % 2 === 0 ? "col-span-2" : "")}
      </div>

      {fixing && (
        <FixPlaceSheet
          entry={fixing.entry}
          place={fixing.index + 1}
          before={fixing.index > 0 ? entries[fixing.index - 1] : null}
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
  before,
  teams,
  canUs,
  label,
  onClose,
  onSend,
}: {
  entry: PlaceEntry;
  place: number;
  before: PlaceEntry | null;
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
                      ? onSend({ type: "tick", team: c, timeMs: entry.timeMs - 1 }, `Added ${label(c)} at ${ordinal(place)}`)
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
            <Button variant="secondary" size="lg" onClick={() => onSend({ type: "edit", targetTapId: tapId, timeMs: before.timeMs - 1 }, `Swapped ${ordinal(place - 1)} and ${ordinal(place)}`)}>
              Swap with {ordinal(place - 1)} ({before.kind === "us" ? "Us" : label(before.kind === "other" ? "other" : before.teamId)})
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
