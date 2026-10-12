import Link from "next/link";

/** Meets / Workouts, for coaches: the two halves of the app. */
export function SectionTabs({ active }: { active: "meets" | "workouts" }) {
  const tab = (key: "meets" | "workouts", label: string) => (
    <Link
      href={`/${key}`}
      aria-current={active === key ? "page" : undefined}
      className={`flex h-9 flex-1 items-center justify-center rounded-md text-sm font-medium transition-colors ${active === key ? "bg-surface-3 text-ink shadow-card" : "text-ink-2 hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="mb-5 flex rounded-lg bg-surface-2 p-1" aria-label="Sections">
      {tab("meets", "Meets")}
      {tab("workouts", "Workouts")}
    </nav>
  );
}
