"use client";

import { Check, Copy, Share } from "lucide-react";
import { useState, useSyncExternalStore, useTransition } from "react";
import { type JoinCodes, regenerateCodesAction } from "@/app/actions/meets";
import { Alert, Button } from "@/components/ui";

/**
 * The meet's join codes, with share links. Codes are stored encrypted, so
 * they can always be shown here; Regenerate replaces them if one leaks.
 */
export function CodesPanel({ meetId, initialCodes, canRegenerate }: { meetId: string; initialCodes: JoinCodes | null; canRegenerate: boolean }) {
  const [codes, setCodes] = useState(initialCodes);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

  const regenerate = () => {
    setConfirming(false);
    start(async () => {
      const result = await regenerateCodesAction(meetId);
      setError(result.error);
      if (result.codes) setCodes(result.codes);
    });
  };

  return (
    <div className="space-y-3">
      {codes ? (
        <div className="divide-y divide-line rounded-lg border border-line">
          <CodeRow label="Manager code" value={codes.managerCode} note="tap, fix, gun" link={`${origin}/join?code=${codes.managerCode}`} />
          <CodeRow label="Coach code" value={codes.coachCode} note="tap, fix, gun, export" link={`${origin}/join?code=${codes.coachCode}`} />
          <CodeRow label="Viewer link" value={`${origin}${codes.viewerPath}`} note="read-only board" link={`${origin}${codes.viewerPath}`} small />
        </div>
      ) : (
        <Alert tone="gold">This meet&rsquo;s codes were created before codes were stored. Regenerate to get ones that stay visible.</Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {canRegenerate && (
        <div className="border-t border-line pt-3">
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              <span>Everyone who joined with the current codes is signed out.</span>
              <Button variant="danger" size="sm" onClick={regenerate}>
                Regenerate
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <p className="text-[13px] text-ink-3">
              If a code gets out,{" "}
              <button type="button" onClick={() => setConfirming(true)} disabled={pending} className="text-ink-2 underline hover:text-ink">
                {pending ? "working…" : "regenerate the codes"}
              </button>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function CodeRow({ label, value, note, link, small }: { label: string; value: string; note: string; link: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  const flashCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Tap the code to copy it; Share opens the phone's share sheet (or copies the link).
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      flashCopied();
    } catch {
      // clipboard blocked; the text is still selectable
    }
  };
  const share = async () => {
    const text = small ? link : `${label} for live splits: ${value}\n${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(link);
      flashCopied();
    } catch {
      // share sheet dismissed, or clipboard blocked; nothing to do
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <button type="button" onClick={copy} title="Tap to copy" className="min-w-0 flex-1 rounded-md text-left active:bg-surface-2">
        <span className="block text-[13px] font-medium text-ink">
          {label} <span className="font-normal text-ink-3">· {note}</span>
        </span>
        <span className={`mt-0.5 flex items-center gap-2 font-mono ${small ? "text-xs text-ink-2" : "text-xl tracking-[0.15em] text-ink"}`}>
          <span className="truncate">{value}</span>
          {copied ? <Check className="size-4 shrink-0 text-brand-text" /> : <Copy className="size-3.5 shrink-0 text-ink-3" />}
        </span>
      </button>
      <Button variant="secondary" size="sm" onClick={share} className="shrink-0">
        <Share className="size-3.5" />
        Share
      </Button>
    </div>
  );
}
