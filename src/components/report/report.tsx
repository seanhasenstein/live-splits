import type { ReactNode } from "react";
import { AppHeader } from "@/components/ui";
import { PrintButton } from "./print-button";

/**
 * The building blocks of the team's reports (the meet PDFs): a branded Letter sheet with the
 * header and footer every report shares, badges, and table styles. Server components; the
 * colors come from `.report-sheet` in globals.css so a sheet looks the same on screen and paper.
 */

/** The page around one or more sheets: the app header and a Download PDF button, neither printed. */
export function ReportShell({ back, title, subtitle, children }: { back: { href: string; label: string }; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg print:bg-white">
      <div className="no-print">
        <AppHeader back={back} title={title} subtitle={subtitle} right={<PrintButton />} />
      </div>
      <main className="py-5 print:py-0">{children}</main>
    </div>
  );
}

export type SheetHeader = {
  /** The line above the title; defaults to the team kicker. */
  kicker?: ReactNode;
  title: ReactNode;
  /** Meet · venue · date, under the title. */
  subline?: ReactNode;
  /** Right side of the header: a summary or a race's numbers. */
  aside?: ReactNode;
};

/** One Letter page. */
export function Sheet({ team, header, legend, tag, children }: { team: TeamBrand; header: SheetHeader; legend?: ReactNode; tag?: ReactNode; children: ReactNode }) {
  return (
    <section className="report-sheet">
      <header className="flex items-start gap-3.5 border-b border-[var(--r-line)] pb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={team.logoSrc} alt="" className="h-14 w-auto shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[9.5px] font-semibold tracking-[0.18em] text-[var(--r-ink-2)] uppercase">
            {header.kicker ?? (
              <>
                {team.kicker} · <span className="text-[var(--r-gold-text)]">Cross Country</span>
              </>
            )}
          </div>
          <h1 className="mt-0.5 text-[26px] leading-tight font-extrabold tracking-tight text-[var(--r-green)] uppercase">{header.title}</h1>
          {header.subline && <div className="mt-0.5 text-[11.5px] text-[var(--r-ink-2)]">{header.subline}</div>}
        </div>
        {header.aside && <div className="shrink-0 text-right">{header.aside}</div>}
      </header>
      <div className="flex-1 pt-4">{children}</div>
      <footer className="mt-5 flex items-end gap-3 border-t border-[var(--r-line)] pt-2.5 text-[8.5px] leading-snug text-[var(--r-ink-2)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={team.logoSrc} alt="" className="h-5 w-auto shrink-0 opacity-80" />
        <div className="min-w-0 flex-1">{legend}</div>
        {tag && <div className="shrink-0 text-right font-semibold tracking-[0.14em] uppercase">{tag}</div>}
      </footer>
    </section>
  );
}

/** Who the reports are for: the kicker ("SHEBOYGAN LUTHERAN CRUSADERS") and logo. */
export type TeamBrand = { kicker: string; logoSrc: string };

export function teamBrand(school: { shortName: string; mascot: string | null }): TeamBrand {
  return { kicker: [school.shortName, school.mascot].filter(Boolean).join(" "), logoSrc: "/shield.svg" };
}

/** A heading inside a sheet: green, tracked caps. */
export function SheetSection({ title, aside, children, className = "" }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`mb-5 break-inside-avoid-page ${className}`}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-bold tracking-[0.14em] text-[var(--r-green)] uppercase">{title}</h2>
        {aside && <div className="text-[10.5px] text-[var(--r-ink-2)]">{aside}</div>}
      </div>
      {children}
    </div>
  );
}

const PILL: Record<"pr" | "sb" | "letter" | "course" | "jv", string> = {
  pr: "bg-[var(--r-green)] text-white",
  sb: "bg-[var(--r-gold)] text-[var(--r-ink)]",
  letter: "bg-[var(--r-green)] text-white",
  course: "bg-[var(--r-green)] text-white",
  jv: "text-[var(--r-ink-2)] ring-1 ring-[var(--r-line)] ring-inset",
};
const PILL_TEXT = { pr: "PR", sb: "SB", letter: "Letter", course: "Course best", jv: "JV" };

export function Pill({ kind, className = "" }: { kind: keyof typeof PILL; className?: string }) {
  return <span className={`inline-flex h-[13px] items-center rounded-[4px] px-1 align-[1px] text-[7.5px] font-bold tracking-[0.06em] uppercase ${PILL[kind]} ${className}`}>{PILL_TEXT[kind]}</span>;
}

/** Table cell classes shared by the reports: tiny green caps headers, hairline rows. */
export const th = "px-1.5 pb-1 text-left align-bottom text-[8px] font-bold tracking-[0.1em] whitespace-nowrap text-[var(--r-green)] uppercase";
export const td = "border-t border-[var(--r-line)] px-1.5 py-[5px] align-top text-[10.5px] whitespace-nowrap";
