"use client";

/** Pill tabs: Overview | Rewards | Manage. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  className?: string;
}) {
  return (
    <div role="tablist" className={`flex rounded-lg bg-surface-2 p-1 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`h-9 min-w-0 flex-1 truncate rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-40 ${
              active ? "bg-surface-3 text-ink shadow-card" : "text-ink-2 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
