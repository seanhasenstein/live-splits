import type { Precision } from "@/lib/db/schema";

const PRECISION_DIGITS: Record<Precision, number> = {
  seconds: 0,
  tenths: 1,
  hundredths: 2,
  thousandths: 3,
};

/** The coarser of two precisions: a team that shows seconds never sees tenths, and a sheet in seconds never gains them. */
export function coarser(a: Precision, b: Precision): Precision {
  return PRECISION_DIGITS[a] <= PRECISION_DIGITS[b] ? a : b;
}

/** Elapsed duration as "m:ss.t" (or "h:mm:ss.t"; "m:ss" at whole seconds). Truncates, like timing systems do. */
export function formatElapsed(ms: number, precision: Precision = "tenths"): string {
  const digits = PRECISION_DIGITS[precision];
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const totalSeconds = Math.floor(abs / 1000);
  const fraction = Math.floor((abs % 1000) / 10 ** (3 - digits));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const frac = String(fraction).padStart(digits, "0");
  const base = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return digits === 0 ? `${sign}${base}` : `${sign}${base}.${frac}`;
}

/** Wall-clock time of an instant in a zone, e.g. "7:10:23.4 PM". */
export function formatClock(epochMs: number, timeZone: string, withTenths = true): string {
  const base = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(epochMs);
  if (!withTenths) return base;
  const tenths = Math.floor((epochMs % 1000) / 100);
  // Insert tenths after the seconds: "7:10:23 PM" -> "7:10:23.4 PM"
  return base.replace(/(\d{2})([\s\u202f][AP]M)?$/, `$1.${tenths}$2`);
}

/** "Friday, Oct 2" for a local date string. */
/** "Sep 10, 2026" for a local date string, in the same short-month style as formatLocalDate. */
export function formatDateWithYear(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}

export function formatLocalDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(y, m - 1, d));
}

/** "Monday, Oct 12, 2026": a page's own date, where the year belongs. */
export function formatLocalDateLong(date: string): string {
  return `${formatLocalDate(date)}, ${date.slice(0, 4)}`;
}

/** "October 17, 2026" for a local date: the reports' long form, month spelled out, no weekday. */
export function formatMonthDayYear(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

/** "7:10 PM" for an "HH:mm" string. */
export function formatTimeOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Epoch ms for a wall-clock time ("HH:mm:ss" or "HH:mm:ss.t") on a local date in a zone. */
export function zonedTimeToEpochMs(date: string, time: string, timeZone: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm, rest = "0"] = time.split(":");
  const seconds = Number(rest);
  const wallMs =
    Date.UTC(y, mo - 1, d, Number(hh), Number(mm), Math.floor(seconds)) +
    Math.round((seconds % 1) * 1000);
  // Guess the zone offset at that instant, then correct once for DST edges.
  let guess = wallMs - zoneOffsetMs(wallMs, timeZone);
  guess = wallMs - zoneOffsetMs(guess, timeZone);
  return guess;
}

/** Offset of `timeZone` from UTC at `epochMs`, in ms (America/Chicago in October: -5h). */
function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(epochMs);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** "6:02.4", "6:02", "1:02:05.12" or "362.4" (seconds) → ms. Null if unreadable. */
/**
 * A time typed on a phone: "6:40", "6:40.5", "12:34", "1:02:03" — or, since a
 * number keypad has no colon, digits alone read like a microwave: "640" is
 * 6:40, "1234" is 12:34, "640.5" is 6:40.5, "45" is 0:45. Anything else is
 * null; seconds must be under 60.
 */
export function parseTypedTime(text: string): number | null {
  const t = text.trim();
  if (t.includes(":")) {
    const ms = parseElapsed(t);
    return ms !== null && /^(\d+:)?\d{1,2}:\d{2}(\.\d{1,3})?$/.test(t) && Number(t.split(":").at(-1)) < 60 && (t.split(":").length < 3 || Number(t.split(":")[1]) < 60) ? ms : null;
  }
  const m = t.match(/^(\d{1,6})(\.\d)?$/); // one digit after the dot: tenths ("6.40" is not 6:40)
  if (!m) return null;
  const digits = m[1].padStart(2, "0");
  const seconds = Number(digits.slice(-2));
  const minutesAll = Number(digits.slice(0, -2) || "0");
  if (seconds >= 60) return null;
  const hours = Math.floor(minutesAll / 100);
  const minutes = minutesAll % 100;
  if (minutes >= 60) return null;
  return Math.round(((hours * 60 + minutes) * 60 + seconds + Number(m[2] ?? 0)) * 1000);
}

/**
 * A duration typed for a rest or a rep goal: "60" and "78.5" are seconds
 * (how coaches say rests and 400s), "1:30" and "3:20" are minutes:seconds,
 * and three or more digits read like a microwave ("320" is 3:20).
 */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (t.includes(":")) return parseTypedTime(t);
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 100) return Math.round(n * 1000);
  return parseTypedTime(t);
}

/** How a duration is written back into a field, the way parseDuration reads it: "45", "78.5"→"1:18.5", "3:20". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) {
    const s = ms / 1000;
    return `${Number.isInteger(s) ? s : s.toFixed(1)}`;
  }
  return formatElapsed(ms, ms % 1000 === 0 ? "seconds" : "tenths");
}

export function parseElapsed(text: string): number | null {
  const m = text.trim().match(/^(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,4}(?:\.\d{1,3})?)$/);
  if (!m) return null;
  const [, a, b, s] = m;
  const h = a && b ? Number(a) : 0;
  const min = a && b ? Number(b) : a ? Number(a) : 0;
  return Math.round((h * 3600 + min * 60 + Number(s)) * 1000);
}
