import { teamKey } from "@/lib/race-places";

/**
 * Team logos, matched to results by a key loose enough that "St. Mary's Springs", "St Mary Springs"
 * and a file named st-mary-springs.png agree: teamKey, apostrophe-s and spaces dropped, Saint as St.
 */
export function logoKey(name: string): string {
  return teamKey(name)
    .replace(/\bsaint\b/g, "st")
    .replace(/\bs\b/g, "")
    .replace(/\s+/g, "");
}

/** Where a team's logo is served; `v` busts the cache when it's replaced. */
export function logoUrl(schoolId: string, key: string, v: number): string {
  return `/api/logos/${schoolId}/${encodeURIComponent(key)}?v=${v}`;
}

/** Up to two initials for a team without a logo: "Cedar Grove-Belgium" → "CG", "Kohler" → "KO". */
export function teamInitials(name: string): string {
  const words = name
    .replace(/\b(high school|hs|the)\b/gi, " ")
    .split(/[\s-]+/)
    .filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

/** A steady hue per team for its initials badge, so a team looks the same everywhere. */
export function teamHue(name: string): number {
  let h = 0;
  for (const c of logoKey(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
