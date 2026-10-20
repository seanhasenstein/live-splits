import type { ReactNode } from "react";
import { AppHeader } from "@/components/ui";
import { PrintButton } from "./print-button";
import { ReportView } from "./report-view";

/**
 * The building blocks of the team's reports, after the meet PDFs: a Letter sheet with the shared
 * header and footer, section headings, a stat strip, badges and table styles. Colors come from
 * `.report-sheet` in globals.css: the paper look, or the app's theme in the web view.
 */

/** The page around the sheets: header, Web / Print layout toggle and Download PDF, none of them printed. */
export function ReportShell({ back, title, subtitle, children }: { back: { href: string; label: string }; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg print:bg-white">
      <div className="no-print">
        <AppHeader back={back} title={title} subtitle={subtitle} right={<PrintButton />} />
      </div>
      <ReportView>{children}</ReportView>
    </div>
  );
}

/** Who the reports are for: the kicker ("SHEBOYGAN LUTHERAN CRUSADERS") and logo. */
export type TeamBrand = { kicker: string; logoSrc: string; name: string };

export function teamBrand(school: { shortName: string; mascot: string | null }): TeamBrand {
  return { kicker: [school.shortName, school.mascot].filter(Boolean).join(" "), logoSrc: "/shield.svg", name: school.shortName };
}

export type SheetHeader = {
  /** The tracked line above the title; defaults to "<team> · Cross Country". */
  kicker?: ReactNode;
  /** Gold kicker (a meet and date) instead of the team line. */
  kickerGold?: boolean;
  title: ReactNode;
  /** Title as written ("On This Course") rather than in capitals. */
  titleCase?: "upper" | "as-is";
  /** Meet • venue • date, under the title. */
  subline?: ReactNode;
  /** Green rule under the header instead of the gray one. */
  greenRule?: boolean;
};

/** One Letter page. */
export function Sheet({ team, header, legend, tag, children }: { team: TeamBrand; header: SheetHeader; legend?: ReactNode; tag?: ReactNode; children: ReactNode }) {
  return (
    <section className="report-sheet">
      <header className={`flex items-center gap-4 pb-3.5 ${header.greenRule ? "border-b-2 border-[var(--r-green-fill)]" : "border-b-[1.5px] border-[var(--r-rule)]"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={team.logoSrc} alt="" className="h-[0.82in] w-auto shrink-0 max-sm:h-14" />
        <div className="min-w-0 flex-1">
          <div className={`text-[9.5px] font-bold tracking-[0.32em] uppercase max-sm:tracking-[0.16em] ${header.kickerGold ? "text-[var(--r-gold-text)]" : "text-[var(--r-ink-2)]"}`}>
            {header.kicker ?? (
              <>
                {team.kicker} · <span className="text-[var(--r-gold-text)]">Cross Country</span>
              </>
            )}
          </div>
          <h1 className={`mt-1 text-[29px] leading-none font-extrabold tracking-tight text-[var(--r-green)] max-sm:text-[22px] ${header.titleCase === "as-is" ? "" : "uppercase"}`}>{header.title}</h1>
          {header.subline && <div className="mt-2 text-[12.5px] leading-snug text-[var(--r-ink-2)]">{header.subline}</div>}
        </div>
      </header>
      <div className="min-w-0 flex-1 pt-4">{children}</div>
      <footer className="mt-6 flex items-center gap-3 border-t border-[var(--r-line)] pt-3 text-[9px] leading-snug text-[var(--r-ink-2)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={team.logoSrc} alt="" className="h-8 w-auto shrink-0" />
        <div className="min-w-0 flex-1">{legend}</div>
        {tag && <div className="shrink-0 text-right text-[9px] tracking-[0.2em] uppercase">{tag}</div>}
      </footer>
    </section>
  );
}

/** Meet • venue • date, the subline most reports share. */
export function MeetLine({ meet, venue, date }: { meet: string; venue?: string | null; date: string }) {
  return (
    <>
      <span className="font-semibold text-[var(--r-ink)]">{meet}</span>
      {venue ? ` • ${venue}` : ""} • {date}
    </>
  );
}

/** A big green heading inside a sheet ("BOYS", "BOYS VARSITY"). */
export function MajorHeading({ children }: { children: ReactNode }) {
  return <h2 className="mt-1 mb-3 text-[20px] leading-none font-extrabold tracking-tight text-[var(--r-green)] uppercase">{children}</h2>;
}

/** A tracked label with an optional gray note, over a thin green rule ("ON THIS COURSE  every race here…"). */
export function SheetSection({ title, note, children, className = "" }: { title: ReactNode; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`mb-4 break-inside-avoid-page ${className}`}>
      <div className="mb-1 flex items-baseline gap-2.5 border-b border-[var(--r-green-fill)] pb-1">
        <h2 className="text-[9.5px] font-bold tracking-[0.2em] whitespace-nowrap text-[var(--r-green)] uppercase">{title}</h2>
        {note && <span className="min-w-0 truncate text-[9.5px] text-[var(--r-ink-2)]">{note}</span>}
      </div>
      {children}
    </div>
  );
}

/** A wide table scrolls sideways on a phone instead of squeezing; on paper it always fits. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto print:overflow-visible">{children}</div>;
}

/** The stat strip under a title: big centered numbers between thin dividers. */
export function KpiStrip({ items }: { items: { label: string; value: string; note?: string; tone?: "green" | "gold" }[] }) {
  return (
    <div className="mb-4 grid grid-cols-4 border-y border-[var(--r-line)] max-sm:grid-cols-2">
      {items.map((k, i) => (
        <div key={k.label} className={`px-2 py-2.5 text-center ${i > 0 ? "border-l border-[var(--r-line)] max-sm:[&:nth-child(3)]:border-l-0" : ""}`}>
          <div className={`text-[24px] leading-none font-extrabold ${k.tone === "gold" ? "text-[var(--r-gold-text)]" : k.tone === "green" ? "text-[var(--r-green)]" : "text-[var(--r-ink)]"}`}>{k.value}</div>
          <div className="mt-1.5 truncate text-[7.5px] font-bold tracking-[0.14em] text-[var(--r-ink-2)] uppercase">
            {k.label}
            {k.note ? ` · ${k.note}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

const PILL: Record<"pr" | "sb" | "letter" | "course" | "jv", string> = {
  pr: "bg-[var(--r-green-fill)] text-white",
  sb: "bg-[var(--r-gold)] text-[#17241a]",
  letter: "bg-[var(--r-green-fill)] text-white",
  course: "bg-[var(--r-green-fill)] text-white",
  jv: "text-[var(--r-ink-2)] ring-1 ring-[var(--r-rule)] ring-inset",
};
const PILL_TEXT = { pr: "PR", sb: "SB", letter: "Letter", course: "Course best", jv: "JV" };

export function Pill({ kind, className = "" }: { kind: keyof typeof PILL; className?: string }) {
  return <span className={`inline-flex h-[14px] items-center rounded-full px-1.5 align-[1px] text-[7.5px] font-bold tracking-[0.06em] uppercase ${PILL[kind]} ${className}`}>{PILL_TEXT[kind]}</span>;
}

/** "11" or "Jr" after a name, small and gray. */
export function Grade({ children }: { children: ReactNode }) {
  return <span className="ml-1 text-[9.5px] font-normal text-[var(--r-ink-3)]">{children}</span>;
}

/** Table cells: tiny tracked headers over a green rule; roomy rows with hairlines. */
export const th = "px-1.5 pt-1 pb-1.5 text-left align-bottom text-[7.5px] font-bold tracking-[0.12em] whitespace-nowrap text-[var(--r-ink-2)] uppercase border-b-[1.5px] border-[var(--r-green-fill)]";
/** A header over a group of columns ("2025 SECTIONAL (THIS COURSE)"). */
export const thGroup = "px-1.5 pt-1 pb-1 text-center align-bottom text-[7.5px] font-bold tracking-[0.1em] whitespace-nowrap text-[var(--r-green)] uppercase border-t border-[var(--r-green-fill)]";
export const td = "border-b border-[var(--r-line)] px-1.5 py-[7px] align-middle text-[12px] whitespace-nowrap";

export function classYear(grade: number | null): string | null {
  return grade === 9 ? "Fr" : grade === 10 ? "So" : grade === 11 ? "Jr" : grade === 12 ? "Sr" : null;
}
