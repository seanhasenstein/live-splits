"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A localStorage string as React state. The server (and the hydrating client)
 * see `null`, so a per-device preference never causes a hydration mismatch;
 * the real value shows up right after hydration.
 */
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const notify = () => listeners.forEach((l) => l());

export function useLocalValue(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const set = useCallback(
    (next: string | null) => {
      try {
        if (next === null) localStorage.removeItem(key);
        else localStorage.setItem(key, next);
      } catch {
        // Private mode or storage full: the preference just doesn't stick.
      }
      notify();
    },
    [key],
  );
  return [value, set];
}
