import localFont from "next/font/local";
import type { ReactNode } from "react";
import "@/app/report-spec.css";
import { AppHeader } from "@/components/ui";
import { PrintButton } from "@/components/report/print-button";
import { RptView } from "./rpt-view";

/**
 * The team's PDFs to the letter of design/report-spec.md: TeX Gyre Heros (the font the PDFs were
 * made in), the spec's stylesheet (report-spec.css), fixed Letter pages with the footer pinned.
 * Pages are server components; the Web / Print layout toggle is the only client part.
 */

const heros = localFont({
  src: [
    { path: "../../app/fonts/heros/texgyreheros-regular.otf", weight: "400", style: "normal" },
    { path: "../../app/fonts/heros/texgyreheros-italic.otf", weight: "400", style: "italic" },
    { path: "../../app/fonts/heros/texgyreheros-bold.otf", weight: "700", style: "normal" },
    { path: "../../app/fonts/heros/texgyreheros-bolditalic.otf", weight: "700", style: "italic" },
  ],
  variable: "--font-heros",
  display: "block",
});

export const LOGO = "/shield.svg";

/** The page around a document: header, Web / Print layout and Download PDF (none printed). */
export function RptShell({ back, title, subtitle, children }: { back: { href: string; label: string }; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className={`min-h-dvh bg-bg print:bg-white ${heros.variable}`}>
      <div className="no-print">
        <AppHeader back={back} title={title} subtitle={subtitle} right={<PrintButton />} />
      </div>
      <RptView>{children}</RptView>
    </div>
  );
}

/** "Meet name • part 2 • part 3", the hero's second line. */
export function HeroMeet({ name, parts }: { name: string; parts: (string | null | undefined)[] }) {
  const rest = parts.filter((p): p is string => !!p);
  return (
    <div className="hero-meet">
      <span className="mn">{name}</span>
      {rest.map((p) => (
        <span key={p} className="contents">
          <span className="dv">•</span>
          {p}
        </span>
      ))}
    </div>
  );
}

/** One Letter page: hero, the page's content, and the footer pinned to the bottom. */
export function RptPage({
  title,
  meetLine,
  heroVariant,
  legend,
  right,
  children,
}: {
  /** Null on a page that continues the one before (no hero). */
  title: string | null;
  meetLine?: ReactNode;
  heroVariant?: "nobar" | "green";
  legend: ReactNode;
  right: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="paper">
      <div className="page">
        {title !== null && (
          <div className={`hero ${heroVariant ?? ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="" />
            <div>
              <div className="eyebrow">
                Sheboygan Lutheran Crusaders · <b>Cross Country</b>
              </div>
              <h1>{title}</h1>
              {meetLine}
            </div>
          </div>
        )}
        {children}
        <div className="footer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} alt="" />
          <div className="lg">{legend}</div>
          <div className="rt">{right}</div>
        </div>
      </div>
    </div>
  );
}

/** The SB / PR badge after a finish; `null` keeps an invisible one so the times stay in a straight column. */
export function Badge({ kind }: { kind: "pr" | "sb" | null }) {
  if (kind === null)
    return (
      <span className="sbp" style={{ visibility: "hidden" }}>
        PR
      </span>
    );
  return <span className={`sbp ${kind === "pr" ? "prp" : ""}`}>{kind === "pr" ? "PR" : "SB"}</span>;
}
