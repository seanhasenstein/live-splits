/**
 * The shortest name that still tells runners apart, for tight spots (buttons, grids, messages):
 * first name if it's unique; first name + last initial if the first name is shared ("Emma K.");
 * first + last name if the initial is shared too ("Emma Krueger", "Emma Kowalski"); else the whole name.
 * Each name is only as long as it has to be: one shared first name doesn't lengthen anyone else's.
 */
export function shortNames(people: { id: string; name: string }[]): Map<string, string> {
  // The last name is the last word that isn't a suffix ("Emma Rose Kay" → Kay; "Joe Smith Jr." → Smith).
  const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;
  const parts = people.map(({ id, name }) => {
    const words = name.trim().split(/\s+/);
    const rest = words.slice(1);
    const last = rest.filter((w) => !SUFFIX.test(w)).at(-1) ?? rest.join(" ");
    return { id, name: name.trim(), first: words[0] ?? "", last };
  });
  const count = (key: (p: (typeof parts)[number]) => string) => {
    const n = new Map<string, number>();
    for (const p of parts) n.set(key(p), (n.get(key(p)) ?? 0) + 1);
    return (p: (typeof parts)[number]) => n.get(key(p)) ?? 0;
  };
  const byFirst = count((p) => p.first.toLowerCase());
  const byInitial = count((p) => `${p.first} ${p.last[0] ?? ""}`.toLowerCase());
  const byFirstLast = count((p) => `${p.first} ${p.last}`.toLowerCase());
  return new Map(
    parts.map((p) => [
      p.id,
      byFirst(p) === 1 || !p.last
        ? p.first
        : byInitial(p) === 1
          ? `${p.first} ${p.last[0]}.`
          : byFirstLast(p) === 1
            ? `${p.first} ${p.last}`
            : p.name,
    ]),
  );
}

/**
 * A name as a person writes it, when results printed part of it in capitals ("Magnus AVERY",
 * "Cable DE TROYE" → "Magnus Avery", "Cable De Troye"). Mixed-case words stay as they are
 * ("McKenna"); one-letter words (initials) too.
 */
export function displayCase(name: string): string {
  return name.replace(/[\p{L}'’]+/gu, (w) => (w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase() ? w[0] + w.slice(1).toLowerCase() : w));
}
