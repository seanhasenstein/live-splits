"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

/**
 * Theme preference: system (default), light, or dark. Stored per device in
 * localStorage and applied as <html data-theme> before first paint by ThemeScript.
 */
export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "ls_theme";
const KEY = THEME_STORAGE_KEY;
const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // storage blocked; still apply for this page
  }
  if (pref === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, read, () => "system");
}

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** Three-way picker. Compact enough for a menu. */
export function ThemeControl({ className = "" }: { className?: string }) {
  const pref = useThemePreference();
  return (
    <div role="radiogroup" aria-label="Theme" className={`flex rounded-md bg-surface-2 p-0.5 ${className}`}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => setThemePreference(value)}
            className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors ${
              active ? "bg-surface-3 text-ink shadow-card" : "text-ink-2 hover:text-ink"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
