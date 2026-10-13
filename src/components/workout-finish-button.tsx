"use client";

import { Flag, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { flagCountAction, setWorkoutFinishedAction } from "@/app/actions/workouts";
import { Button } from "@/components/ui";

/**
 * "End workout" while it's on; "Reopen" after. Ending is undoable, so one tap does it, unless times are
 * flagged to check: then the first tap says so, and a second ends it anyway.
 */
export function WorkoutFinishButton({ workoutId, finished }: { workoutId: string; finished: boolean }) {
  // The count is asked for at the moment of ending (flags come and go on other phones), and the
  // reminder lapses after a few seconds like the other two-tap buttons.
  const [warned, setWarned] = useState<number | null>(null);
  useEffect(() => {
    if (warned === null) return;
    const t = setTimeout(() => setWarned(null), 4000);
    return () => clearTimeout(t);
  }, [warned]);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant={warned !== null ? "gold" : "secondary"}
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!finished && warned === null) {
              const n = await flagCountAction(workoutId);
              if (n > 0) return setWarned(n);
            }
            setWarned(null);
            const r = await setWorkoutFinishedAction(workoutId, !finished);
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
      >
        {finished ? <RotateCcw className="size-3.5" /> : <Flag className="size-3.5" />}
        {finished ? "Reopen" : warned !== null ? `${warned} to check · end anyway` : "End workout"}
      </Button>
      {error && <span className="text-[13px] text-danger">{error}</span>}
    </>
  );
}
