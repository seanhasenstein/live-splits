import { AlertCircle, Check, Info } from "lucide-react";
import type { ReactNode } from "react";

/** Visual only; callers position it and decide when it goes away. */
export function Toast({
  tone = "success",
  title,
  description,
  action,
}: {
  tone?: "success" | "info" | "danger";
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = tone === "success" ? Check : tone === "danger" ? AlertCircle : Info;
  const iconTone = tone === "success" ? "bg-brand text-brand-ink" : tone === "danger" ? "bg-danger text-white" : "bg-ink text-bg";
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-sheet">
      <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
        <Icon className="size-3" strokeWidth={3} />
      </span>
      <div className="min-w-0">
        <div className="tnum text-sm font-medium text-ink">{title}</div>
        {description && <div className="text-[13px] text-ink-2">{description}</div>}
      </div>
      {action && <div className="ml-1 shrink-0">{action}</div>}
    </div>
  );
}
