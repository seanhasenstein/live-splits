"use client";

import { useState } from "react";
import { leaveAction } from "@/app/actions/auth";
import { Button } from "@/components/ui";

/** Ends the session, after an inline confirm: getting back in needs a code. */
export function LeaveButton() {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)} className="ml-2 px-2 py-1 text-xs">
        Leave
      </Button>
    );
  }
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-2">
      <span className="text-xs">You&rsquo;ll need a code to get back in.</span>
      <form action={leaveAction} className="inline">
        <Button variant="danger" type="submit" className="px-2 py-1 text-xs">
          Leave
        </Button>
      </form>
      <Button variant="secondary" onClick={() => setConfirming(false)} className="px-2 py-1 text-xs">
        Stay
      </Button>
    </span>
  );
}
