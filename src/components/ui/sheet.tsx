"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

/** Bottom sheet on phones, centered dialog on wide screens. */
export function Sheet({ title, subtitle, onClose, children }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-t-xl bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-sheet sm:rounded-xl sm:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-ink">{title}</div>
            {subtitle && <div className="mt-0.5 text-[13px] text-ink-2">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink">
            <X className="size-5" />
          </button>
        </div>
        <div className="px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}
