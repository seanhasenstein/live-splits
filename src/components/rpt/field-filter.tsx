"use client";

import { useEffect, useState } from "react";

/**
 * Search and team filter over the whole field (screen only). The rows are server-rendered across the
 * report's pages, so this hides the ones that don't match (rows carry data-name and data-team).
 */
/** `initialQ` / `initialShown`: a search link opens filtered (the server renders the other rows hidden). */
export function FieldFilter({ teams, initialQ = "", initialShown = null }: { teams: string[]; initialQ?: string; initialShown?: number | null }) {
  const [q, setQ] = useState(initialQ);
  const [team, setTeam] = useState("");
  const [shown, setShown] = useState<number | null>(initialShown);
  const apply = (nextQ: string, nextTeam: string) => {
    setQ(nextQ);
    setTeam(nextTeam);
    const needle = nextQ.trim().toLowerCase();
    let n = 0;
    document.querySelectorAll<HTMLTableRowElement>(".rpt tr[data-name]").forEach((r) => {
      const hit = (!nextTeam || r.dataset.team === nextTeam) && (!needle || (r.dataset.name ?? "").includes(needle));
      r.hidden = !hit;
      if (hit) n++;
    });
    setShown(needle || nextTeam ? n : null);
  };
  // Printing always gives the whole field.
  useEffect(() => {
    const all = () => document.querySelectorAll<HTMLTableRowElement>(".rpt tr[data-name]").forEach((r) => (r.hidden = false));
    window.addEventListener("beforeprint", all);
    return () => window.removeEventListener("beforeprint", all);
  }, []);
  return (
    <div className="field-filter no-print">
      <input type="search" value={q} onChange={(e) => apply(e.target.value, team)} placeholder="Find a runner" aria-label="Find a runner" />
      <select value={team} onChange={(e) => apply(q, e.target.value)} aria-label="Team">
        <option value="">All teams</option>
        {teams.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {shown !== null && (
        <span className="ct">
          {shown} runner{shown === 1 ? "" : "s"}
          <button type="button" onClick={() => apply("", "")}>
            Clear
          </button>
        </span>
      )}
    </div>
  );
}
