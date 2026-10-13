import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-[13px] text-danger">{error}</span>
      ) : (
        hint && <span className="mt-1.5 block text-[13px] text-ink-2">{hint}</span>
      )}
    </label>
  );
}

export const controlClass =
  "control h-10 rounded-md border border-line-strong bg-surface px-3 text-[15px] text-ink shadow-[0_1px_2px_rgb(0_0_0/0.03)] placeholder:text-ink-3 disabled:bg-surface-2 disabled:text-ink-3";

// Full width unless the caller sets a width.
const withWidth = (className: string) => (/\bw-/.test(className) ? className : `w-full ${className}`);

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`${controlClass} ${withWidth(className)}`} {...props} />;
}

export function Select({ className = "", children, ...props }: ComponentProps<"select">) {
  return (
    <span className={`relative block ${withWidth(className)}`}>
      <select className={`${controlClass} w-full appearance-none pr-9`} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" />
    </span>
  );
}

export function Checkbox({ label, className = "", ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={`flex cursor-pointer items-center gap-2.5 text-sm text-ink ${className}`}>
      <input type="checkbox" className="checkbox" {...props} />
      {label}
    </label>
  );
}

/** A small on/off switch with its label, for a view setting ("+/−"). */
export function Switch({ checked, onChange, label, className = "" }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`inline-flex items-center gap-1.5 rounded-full py-0.5 text-[11px] font-semibold whitespace-nowrap text-ink-2 hover:text-ink ${className}`}>
      <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${checked ? "bg-brand" : "bg-line-strong"}`}>
        <span className={`absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-3" : ""}`} />
      </span>
      {label}
    </button>
  );
}

/** A yes/no setting as its own bordered row: checkbox, title and a line of explanation; tinted when on. */
export function CheckboxCard({ title, description, checked, onChange, className = "" }: { title: ReactNode; description?: ReactNode; checked: boolean; onChange: (checked: boolean) => void; className?: string }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors ${checked ? "border-brand/50 bg-brand-soft/50" : "border-line bg-surface hover:bg-surface-2"} ${className}`}
    >
      <input type="checkbox" className="checkbox mt-0.5 shrink-0" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description && <span className="mt-0.5 block text-[13px] text-ink-2">{description}</span>}
      </span>
    </label>
  );
}
