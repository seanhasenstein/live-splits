"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { Precision } from "@/lib/db/schema";
import { coarser, formatElapsed } from "@/lib/time";

/** How the team shows times to athletes and parents (program setting). */
export type TeamPrecision = "seconds" | "tenths";

const TimePrecisionContext = createContext<TeamPrecision>("tenths");

export function TimePrecisionProvider({ precision, children }: { precision: TeamPrecision; children: ReactNode }) {
  return <TimePrecisionContext.Provider value={precision}>{children}</TimePrecisionContext.Provider>;
}

/**
 * Formats results the way the team shows them. `source` is what the official
 * sheet carried; a time is never shown finer than that, or finer than the
 * team's setting. The record screen and the running race clock don't use this:
 * they stay at tenths, where a tenth tells a pack apart.
 */
export function useTimeFormat() {
  const team = useContext(TimePrecisionContext);
  return useMemo(
    () => ({
      team,
      ft: (ms: number, source?: Precision | null) => formatElapsed(ms, source ? coarser(team, source) : team),
    }),
    [team],
  );
}
