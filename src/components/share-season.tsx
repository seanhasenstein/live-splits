"use client";

import { Check, Copy, Link2, Share } from "lucide-react";
import { useState, useSyncExternalStore, useTransition } from "react";
import { regenerateSeasonLinkAction } from "@/app/actions/meets";
import { Alert, Button, Sheet } from "@/components/ui";

/** One read-only link for the whole season, for parents and the team page. */
export function ShareSeason({ initialPath }: { initialPath: string | null }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState(initialPath);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const link = path ? `${origin}${path}` : null;

  const regenerate = () => {
    setConfirming(false);
    start(async () => {
      const r = await regenerateSeasonLinkAction();
      setError(r.error);
      if (r.viewerPath) setPath(r.viewerPath);
    });
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked; the text is still selectable
    }
  };
  const share = async () => {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ text: `Live splits for the season: ${link}` });
      else await copy();
    } catch {
      // dismissed
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Link2 className="size-4" />
        Season link
      </Button>
      {open && (
        <Sheet title="Season viewer link" subtitle="Read-only. Opens the meets list and every meet's live results. Share it once with parents." onClose={() => setOpen(false)}>
          <div className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            {link ? (
              <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                <button type="button" onClick={copy} title="Tap to copy" className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="truncate font-mono text-xs text-ink-2">{link}</span>
                  {copied ? <Check className="size-4 shrink-0 text-brand-text" /> : <Copy className="size-3.5 shrink-0 text-ink-3" />}
                </button>
                <Button variant="secondary" size="sm" onClick={share} className="shrink-0">
                  <Share className="size-3.5" />
                  Share
                </Button>
              </div>
            ) : (
              <Button onClick={regenerate} disabled={pending} className="w-full">
                {pending ? "Creating…" : "Create the season link"}
              </Button>
            )}
            {link && (
              <div className="border-t border-line pt-3">
                {confirming ? (
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                    <span>Everyone using the current link is signed out.</span>
                    <Button variant="danger" size="sm" onClick={regenerate} disabled={pending}>
                      Replace it
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <p className="text-[13px] text-ink-3">
                    If the link gets out,{" "}
                    <button type="button" onClick={() => setConfirming(true)} className="text-ink-2 underline hover:text-ink">
                      replace it
                    </button>
                    .
                  </p>
                )}
              </div>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
