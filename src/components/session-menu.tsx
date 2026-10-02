"use client";

import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { leaveAction } from "@/app/actions/auth";
import { ThemeControl } from "@/components/theme";
import { Button } from "@/components/ui";

/** Who you are, and the way out. Leaving needs a code to get back in, so it asks first. */
export function SessionMenu({ name, role }: { name: string; role: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 text-sm hover:bg-surface-2"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-ink">{name.slice(0, 1).toUpperCase()}</span>
        <span className="max-w-24 truncate font-medium">{name}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 rounded-lg border border-line bg-surface p-1 shadow-sheet">
          <div className="px-3 py-2">
            <div className="truncate text-sm font-medium text-ink">{name}</div>
            <div className="text-xs text-ink-2 capitalize">{role}</div>
          </div>
          <div className="my-1 border-t border-line" />
          <div className="px-2 py-1.5">
            <ThemeControl />
          </div>
          <div className="my-1 border-t border-line" />
          {confirming ? (
            <div className="px-3 py-2">
              <p className="mb-2 text-[13px] text-ink-2">You&rsquo;ll need a code to get back in.</p>
              <form action={leaveAction} className="flex gap-2">
                <Button variant="danger" size="sm" type="submit" className="flex-1">
                  Leave
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} className="flex-1">
                  Stay
                </Button>
              </form>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setConfirming(true)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-surface-2"
            >
              <LogOut className="size-4 text-ink-2" />
              Leave
            </button>
          )}
        </div>
      )}
    </div>
  );
}
