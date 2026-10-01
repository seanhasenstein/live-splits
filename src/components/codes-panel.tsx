"use client";

import { useState, useTransition } from "react";
import { type JoinCodes, regenerateCodesAction } from "@/app/actions/meets";
import { Button, ErrorText } from "@/components/ui";

/**
 * Shows join codes right after they are generated. Only hashes are stored, so
 * once this panel is gone the codes can't be shown again — only regenerated.
 */
export function CodesPanel({ meetId, initialCodes }: { meetId: string; initialCodes: JoinCodes | null }) {
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
          <CodeRow label="Manager code" value={codes.managerCode} note="tap" />
          <CodeRow label="Coach code" value={codes.coachCode} note="tap, fix, gun, export" />
          <CodeRow label="Viewer link" value={`${origin}${codes.viewerPath}`} note="read-only board" small />
        </dl>
      ) : (
        <p className="mb-3 text-sm text-green/70">Codes are not shown after creation. Regenerate to get new ones.</p>
      )}
      <ErrorText>{error}</ErrorText>
      {confirming ? (
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
      )}
    </div>
  );
}

function CodeRow({ label, value, note, small }: { label: string; value: string; note: string; small?: boolean }) {
  return (
    <div className="px-3 py-2.5">
      <dt className="text-xs font-bold uppercase tracking-wider text-green/80">
        {label} <span className="font-normal normal-case tracking-normal text-green/60">· {note}</span>
      </dt>
      <dd className={`mt-0.5 select-all font-mono ${small ? "break-all text-xs" : "text-2xl tracking-widest"}`}>{value}</dd>
    </div>
  );
}
