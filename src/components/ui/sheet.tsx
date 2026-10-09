"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const noop = () => () => {};

/** Bottom sheet on phones, centered dialog on wide screens. */
export function Sheet({ title, subtitle, actions, onClose, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  // Portals can't be hydrated: render nothing until mounted, so a sheet open on first paint
  // (a shared ?athlete= link) doesn't throw a hydration mismatch.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      // Keep Tab inside the sheet: the page behind it isn't inert.
      if (e.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!dialog.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;
  // Portal: a parent with backdrop-filter (the sticky bars) would otherwise trap position: fixed.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-xl bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-sheet sm:rounded-xl sm:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-ink">{title}</div>
            {subtitle && <div className="mt-0.5 text-[13px] text-ink-2">{subtitle}</div>}
          </div>
          <div className="-mr-1 flex shrink-0 items-center gap-1">
            {actions}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink">
              <X className="size-5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
