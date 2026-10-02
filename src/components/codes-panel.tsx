"use client";

import { useState, useTransition } from "react";
import { type JoinCodes, regenerateCodesAction } from "@/app/actions/meets";
import { Button, ErrorText } from "@/components/ui";

/**
 * The meet's join codes, with share links. Codes are stored encrypted, so
 * they can always be shown here; Regenerate replaces them if one leaks.
 */
export function CodesPanel({ meetId, initialCodes, canRegenerate }: { meetId: string; initialCodes: JoinCodes | null; canRegenerate: boolean }) {
  const [codes, setCodes] = useState(initialCodes);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const regenerate = () => {
    setConfirming(false);
    start(async () => {
      const result = await regenerateCodesAction(meetId);
      setError(result.error);
      if (result.codes) setCodes(result.codes);
    });
  };

  return (
    <div>
      {codes ? (
        <dl className="mb-3 divide-y divide-green/20 rounded border border-green/30 bg-white">
          <CodeRow label="Manager code" value={codes.managerCode} note="tap, fix, gun" link={`${origin}/join?code=${codes.managerCode}`} />
          <CodeRow label="Coach code" value={codes.coachCode} note="tap, fix, gun, export" link={`${origin}/join?code=${codes.coachCode}`} />
          <CodeRow label="Viewer link" value={`${origin}${codes.viewerPath}`} note="read-only board" link={`${origin}${codes.viewerPath}`} small />
        </dl>
      ) : (
        <p className="mb-3 text-sm text-green/70">
          This meet&rsquo;s codes were created before codes were stored; regenerate to get ones that stay visible.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      {canRegenerate &&
        (confirming ? (
          <div className="flex items-center gap-2 text-sm">
            <span>Current codes stop working immediately.</span>
            <Button variant="danger" onClick={regenerate} className="px-3 py-1.5 text-xs">
              Regenerate
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} className="px-3 py-1.5 text-xs">
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)} disabled={pending} className="px-3 py-1.5 text-xs">
            {pending ? "Working…" : "Regenerate codes"}
          </Button>
        ))}
    </div>
  );
}

function CodeRow({ label, value, note, link, small }: { label: string; value: string; note: string; link: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const text = small ? link : `${label} for live splits: ${value}\n${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // share sheet dismissed, or clipboard blocked; nothing to do
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-bold uppercase tracking-wider text-green/80">
          {label} <span className="font-normal normal-case tracking-normal text-green/60">· {note}</span>
        </dt>
        <dd className={`mt-0.5 select-all font-mono ${small ? "break-all text-xs" : "text-2xl tracking-widest"}`}>{value}</dd>
      </div>
      <Button variant="secondary" onClick={share} className="shrink-0 px-3 py-1.5 text-xs">
        {copied ? "Copied" : "Share"}
      </Button>
    </div>
  );
}
