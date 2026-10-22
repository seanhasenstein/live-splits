"use client";

import { CalendarDays, Search as SearchIcon, User, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SearchHit } from "@/lib/search";

const GROUPS: { kind: SearchHit["kind"]; label: string }[] = [
  { kind: "athlete", label: "Our athletes" },
  { kind: "meet", label: "Meets" },
  { kind: "runner", label: "Other runners" },
];

/**
 * Search across athletes, meets and other schools' runners: a button in the header, or ⌘K / Ctrl K
 * anywhere. Arrow keys move, Enter opens, Escape closes. Full screen on a phone.
 */
export function SearchButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink max-sm:w-8 max-sm:justify-center max-sm:px-0"
        aria-label="Search"
      >
        <SearchIcon className="size-4" />
        <span className="max-sm:hidden">Search</span>
        <kbd className="rounded border border-line px-1 font-sans text-[11px] text-ink-3 max-sm:hidden">⌘K</kbd>
      </button>
      {open && createPortal(<Palette onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const query = (text: string) => {
    setQ(text);
    setActive(0);
    if (text.trim().length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
  };
  // Debounced fetch; a newer query cancels the one before.
  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, {
        signal: ctl.signal,
      })
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((d: { hits: SearchHit[] }) => {
          setHits(d.hits);
          setLoading(false);
        })
        .catch(() => {
          // A newer query aborted this one; anything else (offline) shouldn't leave "Searching…" up.
          if (!ctl.signal.aborted) {
            setHits([]);
            setLoading(false);
          }
        });
    }, 140);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q]);

  // Grouped in display order; `active` indexes this flat list.
  const ordered = GROUPS.flatMap((g) => hits.filter((h) => h.kind === g.kind));
  const go = (h: SearchHit | undefined) => {
    if (!h) return;
    onClose();
    router.push(h.href);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(ordered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(ordered[active]);
    }
  };
  const icon = (k: SearchHit["kind"]) =>
    k === "athlete" ? <UserRound className="size-4 text-brand-text" /> : k === "meet" ? <CalendarDays className="size-4 text-ink-2" /> : <User className="size-4 text-ink-3" />;
  const trimmed = q.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 sm:pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="flex w-full flex-col overflow-hidden bg-surface shadow-xl max-sm:h-dvh sm:max-h-[70vh] sm:max-w-xl sm:rounded-xl sm:border sm:border-line"
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <SearchIcon className="size-4 shrink-0 text-ink-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => query(e.target.value)}
            placeholder="Search athletes, meets, other runners"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
            role="combobox"
            aria-expanded={ordered.length > 0}
            aria-controls="search-results"
            aria-activedescendant={ordered[active] ? `hit-${active}` : undefined}
          />
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Close search">
            <X className="size-4" />
          </button>
        </div>
        <div id="search-results" role="listbox" className="flex-1 overflow-y-auto py-2">
          {trimmed.length < 2 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-2">Type a name: one of ours, a meet, or a runner from another school.</p>
          ) : ordered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-2">{loading ? "Searching…" : `Nothing matches “${trimmed}”.`}</p>
          ) : (
            GROUPS.map((g) => {
              const list = ordered.filter((h) => h.kind === g.kind);
              if (list.length === 0) return null;
              return (
                <div key={g.kind} className="mb-1">
                  <div className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{g.label}</div>
                  {list.map((h) => {
                    const i = ordered.indexOf(h);
                    return (
                      <button
                        key={h.href}
                        id={`hit-${i}`}
                        role="option"
                        aria-selected={i === active}
                        type="button"
                        onMouseMove={() => setActive(i)}
                        onClick={() => go(h)}
                        className={`flex w-full items-center gap-3 px-4 py-2 text-left ${i === active ? "bg-surface-2" : ""}`}
                      >
                        {icon(h.kind)}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{h.title}</span>
                          <span className="block truncate text-xs text-ink-2">{h.detail}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
