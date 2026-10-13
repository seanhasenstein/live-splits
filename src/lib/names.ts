/**
 * The shortest name that still tells runners apart, for tight spots (buttons, grids, messages):
 * first name if it's unique; first name + last initial if the first name is shared ("Emma K.");
 * first + last name if the initial is shared too ("Emma Krueger", "Emma Kowalski"); else the whole name.
 * Each name is only as long as it has to be: one shared first name doesn't lengthen anyone else's.
 */
export function shortNames(people: { id: string; name: string }[]): Map<string, string> {
  const parts = people.map(({ id, name }) => {
    const words = name.trim().split(/\s+/);
    return { id, name: name.trim(), first: words[0] ?? "", last: words.slice(1).join(" ") };
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
