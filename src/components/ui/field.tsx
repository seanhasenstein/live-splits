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
  "h-10 rounded-md border border-line-strong bg-surface px-3 text-[15px] text-ink shadow-[0_1px_2px_rgb(0_0_0/0.03)] placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-surface-2 disabled:text-ink-3";

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
      <input type="checkbox" className="size-[18px] rounded border-line-strong accent-brand" {...props} />
      {label}
    </label>
  );
}
