"use client";

/** Pill switch for one choice: Everyone | Girls | Boys. (Radio semantics: these pick a view, they don't own panels.) */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className = "",
  scroll = false,
  size = "md",
  joined = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  className?: string;
  /** Too many options to fit: keep every label whole and let the row scroll sideways. */
  scroll?: boolean;
  /** "sm" for a switch tucked into a card header. */
  size?: "sm" | "md";
  /** A button group: the buttons touch, square where they meet, rounded only at the ends. */
  joined?: boolean;
}) {
  if (joined) {
    return (
      <div role="radiogroup" className={`flex divide-x divide-line-strong overflow-hidden rounded-md border border-line-strong ${className}`}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              role="radio"
              type="button"
              aria-checked={active}
              disabled={o.disabled}
              onClick={() => onChange(o.value)}
              className={`${size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3 text-sm"} min-w-0 flex-1 truncate font-medium transition-colors disabled:opacity-40 ${
                active ? "bg-surface-3 text-ink" : "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    // The same inset around the buttons at both sizes, so the selected one never crowds the track's edge.
    <div role="radiogroup" className={`flex gap-0.5 rounded-lg bg-surface-2 p-1 ${scroll ? "[scrollbar-width:none] overflow-x-auto" : ""} ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            type="button"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`${size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3 text-sm"} rounded-md ${scroll ? "flex-[1_0_auto] whitespace-nowrap" : "min-w-0 flex-1 truncate"} font-medium transition-colors disabled:opacity-40 ${
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
