import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/** A bordered white surface. Sections inside are separated by hairlines. */
export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-lg border border-line bg-surface shadow-card ${className}`} {...props} />;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`border-t border-line px-4 py-4 ${className}`} {...props} />;
}

/** Small muted heading over a group of things; the PDFs' tracked label, used sparingly. */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase ${className}`}>{children}</div>;
}

/** The PDFs' big-number stat: 47 / PTS. */
export function Stat({ value, label, tone = "ink" }: { value: ReactNode; label: string; tone?: "ink" | "brand" | "gold" }) {
  const color = tone === "brand" ? "text-brand-text" : tone === "gold" ? "text-gold-text" : "text-ink";
  return (
    <div>
      <div className={`tnum text-2xl leading-none font-semibold ${color}`}>{value}</div>
      <div className="mt-1 text-[11px] font-medium tracking-[0.08em] text-ink-2 uppercase">{label}</div>
    </div>
  );
}

type RowProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
};

/** Settings-style row: icon, title/description, trailing meta, chevron. Stack inside a Card with divide-y. */
export function ListRow({ icon, title, description, meta, href, onClick, chevron = !!(href || onClick) }: RowProps) {
  const inner = (
    <>
      {icon && <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-2 [&>svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{title}</span>
        {description && <span className="block truncate text-[13px] text-ink-2">{description}</span>}
      </span>
      {meta && <span className="tnum shrink-0 text-[13px] text-ink-2">{meta}</span>}
      {chevron && <ChevronRight className="size-4 shrink-0 text-ink-3" />}
    </>
  );
  const cls = "flex w-full items-center gap-3 px-4 py-3 text-left";
  if (href) return <Link href={href} className={`${cls} hover:bg-surface-2`}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={`${cls} hover:bg-surface-2`}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

export function Badge({ tone = "neutral", dot, children }: { tone?: "neutral" | "brand" | "gold" | "danger"; dot?: boolean; children: ReactNode }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2 border-line",
    brand: "bg-brand-soft text-brand-text border-brand/20",
    gold: "bg-gold-soft text-gold-text border-gold/40",
    danger: "bg-danger-soft text-danger border-danger/30",
  };
  const dots = { neutral: "bg-ink-3", brand: "bg-brand", gold: "bg-gold", danger: "bg-danger" };
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium ${tones[tone]}`}>
      {dot && <span className={`size-1.5 rounded-full ${dots[tone]}`} />}
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-surface-2 text-ink-2 [&>svg]:size-5">{icon}</div>}
      <div className="text-sm font-medium text-ink">{title}</div>
      {description && <p className="mt-1 max-w-xs text-[13px] text-ink-2">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "neutral", title, children }: { tone?: "neutral" | "danger" | "gold"; title?: string; children?: ReactNode }) {
  const tones = {
    neutral: "border-line bg-surface-2 text-ink",
    danger: "border-danger/30 bg-danger-soft text-danger",
    gold: "border-gold/40 bg-gold-soft text-gold-text",
  };
  return (
    <div className={`rounded-md border px-3 py-2.5 text-[13px] ${tones[tone]}`} role={tone === "danger" ? "alert" : undefined}>
      {title && <div className="font-semibold">{title}</div>}
      {children}
    </div>
  );
}

/** Tabular numerals for anything that is a time. */
export function Time({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`tnum ${className}`}>{children}</span>;
}
