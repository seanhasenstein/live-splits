import type { Athlete, Race } from "@/lib/db/schema";
import type { Mark, RaceState } from "@/lib/replay";

/**
 * CSV in the layout of Sean's split workbook (one sheet per race):
 *   row 1 title, row 2 note, row 3 blank, row 4 header, then one row per athlete.
 * The first 13 columns match the workbook exactly; the pipeline fills the
 * Previous SB / letter columns itself, so they are left empty. Flag columns
 * are appended after, so they can be ignored or used.
 */

export type ExportAthlete = Pick<Athlete, "_id" | "displayName" | "graduationYear"> & { levelId: string; grade: number | null };

const FIXED_HEADER = ["Race", "Place", "Athlete", "Gr", "Official Finish", "Finish"];
const TRAILING_HEADER = ["Previous SB", "Prev SB Meet", "New SB?", "Change", "Letter?"];

/** m:ss, truncated, the way the workbook expects mile times to be typed. */
export function formatWorkbookTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function flag(m: Mark | undefined): string {
  if (!m) return "";
  if (m.missed) return "missed";
  return [m.estimate && "estimate", m.edited && "edited"].filter(Boolean).join("+");
}

export function buildExportRows(input: {
  race: Pick<Race, "checkpoints" | "gunTimeMs" | "levelIds">;
  state: RaceState;
  athletes: ExportAthlete[];
  levelLabel: (id: string) => string;
}): string[][] {
  const { race, state, athletes, levelLabel } = input;
  const splits = race.checkpoints.filter((c) => c.kind === "split");
  const finish = race.checkpoints.find((c) => c.kind === "finish");
  const gun = race.gunTimeMs;

  const header = [
    ...FIXED_HEADER,
    ...splits.map((c) => `${c.label} (cumulative)`),
    ...TRAILING_HEADER,
    ...(finish ? ["Finish Flag"] : []),
    ...splits.map((c) => `${c.label} Flag`),
  ];

  const markOf = (athleteId: string, cpId: string | undefined) => (cpId ? state.get(cpId)?.byAthlete.get(athleteId) : undefined);
  const elapsed = (m: Mark | undefined) => (gun && m?.timeMs != null ? m.timeMs - gun : null);

  const levelOrder = new Map(race.levelIds.map((id, i) => [id, i]));
  const rows = athletes.map((a) => {
    const finishMark = markOf(a._id, finish?.id);
    const splitMarks = splits.map((c) => markOf(a._id, c.id));
    // Furthest checkpoint reached (finish = highest), then the time there.
    const progress = [...splitMarks, finishMark].map(elapsed);
    const reached = progress.reduce<number>((best, t, i) => (t === null ? best : i), -1);
    return {
      level: levelOrder.get(a.levelId) ?? 99,
      reached,
      time: reached < 0 ? Infinity : (progress[reached] ?? Infinity),
      name: a.displayName,
      cells: [
        levelLabel(a.levelId),
        "", // Place: from official results
        a.displayName,
        a.grade === null ? "" : String(a.grade),
        "", // Official Finish: from official results
        elapsed(finishMark) === null ? "" : formatWorkbookTime(elapsed(finishMark)!),
        ...splitMarks.map((m) => (elapsed(m) === null ? "" : formatWorkbookTime(elapsed(m)!))),
        ...TRAILING_HEADER.map(() => ""),
        ...(finish ? [flag(finishMark)] : []),
        ...splitMarks.map(flag),
      ],
    };
  });
  rows.sort((x, y) => x.level - y.level || y.reached - x.reached || x.time - y.time || x.name.localeCompare(y.name));
  return [header, ...rows.map((r) => r.cells)];
}

export function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
