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
/** One finger can't tap a button twice this fast; two runners of one team can be 80 ms apart. */
const BOUNCE_MS = 40;
const HOLD_MS = 500;
const PACK_GAP_MS = 10;
/** Other (and its pack buttons) is outlined: one group, never mistaken for Capture time or a team. */
const OTHER = { bg: "var(--color-surface)", ink: "var(--color-ink)" };
const OTHER_EDGE = "border-2 border-line-strong";
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
  ourExpected,
  onOurTap,
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
  /** How many of ours should pass here (the lineup less anyone out of the race), for "5 of 7". */
  ourExpected: number;
  /** One of ours was just counted (the shout card). */
  onOurTap: (tapId: string) => void;
}) {
  // The last-tap pill flashes on each tap from this phone: a confirmation seen from the corner of the eye.
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashNow = () => {
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 450);
  };
  // The tap being fixed; its place and neighbours are read fresh each render (places can shift while open).
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  /** Taps counted per button: a new value restarts that button's flash (in the button's text color, so it shows on every background). */
  const [flashes, setFlashes] = useState<Record<string, number>>({});
  const flashButton = (key: string) => setFlashes((f) => ({ ...f, [key]: (f[key] ?? 0) + 1 }));
  const flashLayer = (key: string) =>
    flashes[key] ? <span key={flashes[key]} aria-hidden className="pointer-events-none absolute inset-0 rounded-lg bg-current opacity-0 animate-[place-flash_160ms_ease-out]" /> : null;
  const [burst, setBurst] = useState<number | null>(null);
  const lastTap = useRef(new Map<string, number>());
  /** When a finger landed on each button: a tap's time is its own button's, never another thumb's. */
  const downAt = useRef(new Map<string, number>());
  const timeFor = (key: string, e: SyntheticEvent) => {
    const at = downAt.current.get(key);
    return at !== undefined && Date.now() - at < 1500 ? at : eventTime(e);
  };
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  // A new checkpoint starts with nothing open.
  const [seenCp, setSeenCp] = useState(checkpointId);
  if (seenCp !== checkpointId) {
    setSeenCp(checkpointId);
    setFixingId(null);
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
    const at = timeFor(team, e);
    if (at - (lastTap.current.get(team) ?? 0) < BOUNCE_MS) return;
    lastTap.current.set(team, at);
    const tapId = send({ ...base, type: "tick", team, deviceTimeMs: at });
    buzz();
    flashNow();
    flashButton(team);
    if (team === "us") onOurTap(tapId);
    onAction({ tapIds: [tapId], label: `${ordinal(counted + 1)} ${label(team)}` });
  };
  // A clump of untracked runners: n Others at once, a few ms apart so they keep their order.
  const pack = (e: SyntheticEvent, n: number) => {
    const at = timeFor(`pack${n}`, e);
    const tapIds = Array.from({ length: n }, (_, i) => send({ ...base, type: "tick", team: "other", deviceTimeMs: at + i * PACK_GAP_MS }));
    buzz();
    flashNow();
    flashButton(`pack${n}`);
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
  // The pack buttons sit beside Other when there's room: always on Places, and on Times + places when
  // there are no team buttons. Otherwise Other is held for a pack.
  const showPacks = big || teams.length === 0;
  // How many of each team have passed here: a missed tap shows up as a count that looks low.
  const countOf = (team: string) => entries.filter((e) => (e.kind === "us" ? "us" : e.kind === "other" ? "other" : e.teamId) === team).length;
  // More of ours than are running: the tap still counts (an earlier one may have been another team),
  // and Fix turns red until it's sorted out.
  const overUs = countOf("us") > ourExpected;
  const button = (team: string, name: string, colors: { bg: string; ink: string }, extra = "") => (
    <button
      key={team}
      type="button"
      disabled={locked}
      onPointerDown={() => {
        onPointer();
        downAt.current.set(team, Date.now());
        held.current = false;
        if (team === "other" && !showPacks) holdStart();
      }}
      onPointerUp={team === "other" ? holdEnd : undefined}
      onPointerLeave={team === "other" ? holdEnd : undefined}
      onPointerCancel={team === "other" ? holdEnd : undefined}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => tick(e, team)}
      // Teams (and ours): the color slightly softened inside a full-strength rim, like Capture time.
      // Other keeps its outline (its border comes from OTHER_EDGE).
      style={
        team === "other"
          ? { background: colors.bg, color: colors.ink, WebkitTouchCallout: "none" }
          : { background: `color-mix(in srgb, ${colors.bg} 90%, transparent)`, border: `2px solid ${colors.bg}`, color: colors.ink, WebkitTouchCallout: "none" }
      }
      className={`relative flex flex-col items-center justify-center rounded-lg font-bold shadow-card transition-transform duration-75 select-none active:scale-[0.97] disabled:opacity-40 ${big ? "h-full min-h-0 text-2xl" : "h-14 text-lg"} ${extra}`}
    >
      {flashLayer(team)}
      {/* How many of them have passed here; for ours, of how many are coming (still waiting on some = don't stop yet). */}
      {(countOf(team) > 0 || team === "us") && (
        <span className={`tnum absolute top-2 right-2 rounded-md px-1.5 py-px text-sm leading-tight font-bold ${team === "us" && overUs ? "bg-danger text-white" : "bg-black/35 text-white"}`}>
          {team === "us" ? `${countOf("us")} of ${ourExpected}` : countOf(team)}
        </span>
      )}
      {name}
      {team === "other" && <span className="text-[10px] font-medium opacity-75">{showPacks ? "+1" : "hold for a pack"}</span>}
    </button>
  );

  const packButtons = [2, 3, 4].map((n) => (
    <button
      key={n}
      type="button"
      disabled={locked}
      onPointerDown={() => {
        onPointer();
        downAt.current.set(`pack${n}`, Date.now());
      }}
      onClick={(e) => pack(e, n)}
      aria-label={`${n} Others`}
      className={`relative flex flex-1 flex-col items-center justify-center rounded-lg border-2 border-line-strong bg-surface font-bold text-ink shadow-card transition-transform duration-75 select-none active:scale-[0.97] disabled:opacity-40 ${big ? "h-full min-h-0 text-xl" : "h-14 text-lg"}`}
    >
      {flashLayer(`pack${n}`)}
      +{n}
      <span className="text-[10px] font-medium text-ink-3">Others</span>
    </button>
  ));

  const fixIndex = fixingId ? entries.findIndex((e) => e.tapId === fixingId) : -1;
  // Gone (undone from another phone): nothing to fix.
  const fixing = fixIndex >= 0 ? { entry: entries[fixIndex], index: fixIndex } : null;
  const last = entries.at(-1) ?? null;
  const teamOf = (e: PlaceEntry) => (e.kind === "us" ? "us" : e.kind === "other" ? "other" : e.teamId);
  const colorsOf = (team: string) => (team === "us" ? US : team === "other" ? null : placeColor(teams.find((t) => t.id === team)?.color ?? "gray"));
  const textOf = (e: PlaceEntry) => (e.kind === "us" && e.athleteId ? `${ourTeam.short} · ${(athletes[e.athleteId] ?? "?").split(" ")[0]}` : label(teamOf(e)));
  const lastColors = last ? colorsOf(teamOf(last)) : null;

  return (
    <div className={`px-3 pt-2 ${big ? "flex min-h-0 flex-1 flex-col" : ""}`}>
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
                Next place <span className="tnum font-semibold text-ink-2">{ordinal(counted + 1)}</span>
                {places && !places.countingAll && teams.length > 0 && "*"}
              </span>
            </>
          ) : (
            <span className="truncate text-sm text-ink-3">Waiting for the first runner</span>
          )}
        </div>
        {entries.some((e) => e.tapId) && (
          <Button
            variant={overUs ? "danger-solid" : "secondary"}
            size="sm"
            onClick={() => setListOpen(true)}
            className="h-8 shrink-0 px-2"
            title={overUs ? `${countOf("us")} of ours counted, ${ourExpected} running: was one of them another team?` : undefined}
          >
            <Pencil className="size-3.5" />
            Fix
          </Button>
        )}
        {/* Scores need someone to score against: no tracked teams, no Scores. */}
        {places && teams.length > 0 && (
          <Button variant="secondary" size="sm" onClick={onScores} className="h-8 shrink-0 px-2">
            <Trophy className="size-3.5" />
            Scores
          </Button>
        )}
        {/* On Times + places, finishing here is one step at the end (Done here · Go to …); only Count again shows in the row. */}
        {(mode === "places" || locked) && <Button variant={locked ? "primary" : "secondary"} size="sm" onClick={() => onLock(!locked)} aria-label={locked ? "Count again" : "Done counting"} className="h-8 shrink-0 px-2">
          {locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
          {locked ? "Count again" : "Done"}
        </Button>}
        {/* Over the row, not above the buttons, so the buttons never move under a thumb. */}
        {burst !== null && !locked && (
          <div className="absolute inset-x-0 bottom-0 z-10 grid grid-cols-4 gap-1.5 bg-bg">
            {/* +1 too: the press that opened this was a runner. */}
            {[1, 2, 3, 4].map((n) => (
              <Button
                key={n}
                variant="secondary"
                onPointerDown={() => {
                  onPointer();
                  downAt.current.set(`pack${n}`, Date.now());
                }}
                onClick={(e) => pack(e, n)} className="h-12 text-base font-bold">
                +{n}
              </Button>
            ))}
          </div>
        )}
      </div>

      {big ? (
        // Places: the buttons share the screen's height (nothing to scroll mid-pack). Up to three
        // teams get a full-width row each; more go two to a row. Other has the pack buttons beside it.
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="flex min-h-0 flex-[1.3]">{button("us", ourTeam.name, US, "w-full")}</div>
          {(teams.length <= 3 ? teams.map((t) => [t]) : Array.from({ length: Math.ceil(teams.length / 2) }, (_, i) => teams.slice(i * 2, i * 2 + 2))).map((row) => (
            <div key={row[0].id} className="flex min-h-0 flex-1 gap-1.5">
              {row.map((t) => button(t.id, t.short, placeColor(t.color), "flex-1"))}
            </div>
          ))}
          <div className="flex min-h-0 flex-1 gap-1.5">
            {button("other", "Other", OTHER, `flex-[2] ${OTHER_EDGE}`)}
            {packButtons}
          </div>
        </div>
      ) : (
        // Times + places: the buttons always fill the row (up to four across, then a second row).
        // With no teams to track, Other gets the pack buttons beside it.
        teams.length === 0 ? (
          <div className="flex gap-1.5">
            {button("other", "Other", OTHER, `flex-[2] ${OTHER_EDGE}`)}
            {packButtons}
          </div>
        ) : (
          <div className={`grid gap-1.5 ${["", "", "grid-cols-2", "grid-cols-3"][teams.length + 1] ?? "grid-cols-4"}`}>
            {teams.map((t) => button(t.id, t.short, placeColor(t.color)))}
            {button("other", "Other", OTHER, OTHER_EDGE)}
          </div>
        )
      )}

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
                      onClick={() => setFixingId(entry.tapId)}
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
          onClose={() => setFixingId(null)}
          onSend={(input, toast) => {
            const tapId = send({ ...base, ...input });
            onAction({ tapIds: [tapId], label: toast });
            onToast(toast);
            setFixingId(null);
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
