import { CalendarRange, Flag, Timer, UsersRound } from "lucide-react";
import Link from "next/link";

type Section = "meets" | "athletes" | "reports" | "workouts";

/**
 * The app's sections for school-wide coaches and viewers: tabs at the top of the page on wider
 * screens, a tab bar along the bottom on a phone. Workouts only for coaches.
 */
export function SectionTabs({ active, workouts = false }: { active: Section; workouts?: boolean }) {
  const items: { key: Section; label: string; icon: typeof Flag }[] = [
    { key: "meets", label: "Meets", icon: Flag },
    { key: "athletes", label: "Athletes", icon: UsersRound },
    { key: "reports", label: "Season", icon: CalendarRange },
    ...(workouts ? [{ key: "workouts" as const, label: "Workouts", icon: Timer }] : []),
  ];
  return (
    <>
      <nav className="mb-5 flex rounded-lg bg-surface-2 p-1 max-sm:hidden" aria-label="Sections">
        {items.map(({ key, label }) => (
          <Link
            key={key}
            href={`/${key}`}
            aria-current={active === key ? "page" : undefined}
            className={`flex h-9 flex-1 items-center justify-center rounded-md text-sm font-medium transition-colors ${active === key ? "bg-surface-3 text-ink shadow-card" : "text-ink-2 hover:text-ink"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {/* Phone: the bar along the bottom (globals.css pads the page for it). */}
      <nav data-tabbar className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden print:hidden" aria-label="Sections">
        {items.map(({ key, label, icon: Icon }) => (
          <Link
            key={key}
            href={`/${key}`}
            aria-current={active === key ? "page" : undefined}
            className={`flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active === key ? "text-brand-text" : "text-ink-2"}`}
          >
            <Icon className="size-5" strokeWidth={active === key ? 2.25 : 1.75} />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
