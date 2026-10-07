"use client";

import { Share2 } from "lucide-react";
import { useState } from "react";
import type { JoinCodes } from "@/app/actions/meets";
import { CodesPanel } from "@/components/codes-panel";
import { Button, Sheet } from "@/components/ui";

/** The meet's join codes and viewer link, behind a Share button so the meet page stays about the races. */
export function ShareMeet({ meetId, codes, canRegenerate }: { meetId: string; codes: JoinCodes | null; canRegenerate: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Share2 className="size-4" />
        Share
      </Button>
      {open && (
        <Sheet title="Share this meet" subtitle="Managers join with the manager code; the viewer link is read-only. Tap a code to copy it." onClose={() => setOpen(false)}>
          <CodesPanel meetId={meetId} initialCodes={codes} canRegenerate={canRegenerate} />
        </Sheet>
      )}
    </>
  );
}
