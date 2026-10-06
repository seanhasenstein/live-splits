import type { LineupHistory, PriorResult } from "@/lib/results/history";

/**
 * How the record screen lays out the tiles. Runners without data for the
 * chosen order go last, A–Z, so the grid never hides anyone.
 */
export type OrderMode =
  | { kind: "prev" }
  | { kind: "last" }
  | { kind: "race"; raceId: string }
  | { kind: "best" }
  | { kind: "coach" }
  | { kind: "az" };

export const orderKey = (m: OrderMode) => (m.kind === "race" ? `race:${m.raceId}` : m.kind);

export function parseOrderMode(s: string | null): OrderMode | null {
  if (!s) return null;
  if (s.startsWith("race:")) return { kind: "race", raceId: s.slice(5) };
  if (s === "prev" || s === "last" || s === "best" || s === "coach" || s === "az") return { kind: s };
  return null;
}

/** The most recent prior result with a finish time. */
export const lastFinished = (list: PriorResult[] | undefined): PriorResult | undefined => list?.find((r) => r.finishMs !== null);

export const seasonBest = (list: PriorResult[] | undefined): PriorResult | undefined =>
  list?.filter((r) => r.prSb && r.finishMs !== null).sort((a, b) => a.finishMs! - b.finishMs!)[0];

export function orderAthletes(
  mode: OrderMode,
  ctx: {
    /** Coach's order: the lineup as saved. */
    lineup: string[];
    names: Record<string, string>;
    history: LineupHistory;
    /** Cumulative ms at the previous checkpoint, if recorded. */
    prevTime: (id: string) => number | null;
  },
): string[] {
  const name = (id: string) => ctx.names[id] ?? "";
  const az = (a: string, b: string) => name(a).localeCompare(name(b));
  const byValue = (value: (id: string) => number | null) =>
    [...ctx.lineup].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null && vb === null) return az(a, b);
      if (va === null) return 1;
      if (vb === null) return -1;
      return va - vb || az(a, b);
    });
  switch (mode.kind) {
    case "coach":
      return [...ctx.lineup];
    case "az":
      return [...ctx.lineup].sort(az);
    case "prev":
      return byValue(ctx.prevTime);
    case "last":
      return byValue((id) => lastFinished(ctx.history.byAthlete[id])?.finishMs ?? null);
    case "best":
      return byValue((id) => seasonBest(ctx.history.byAthlete[id])?.finishMs ?? null);
    case "race":
      return byValue((id) => ctx.history.byAthlete[id]?.find((r) => r.raceId === mode.raceId)?.finishMs ?? null);
  }
}
