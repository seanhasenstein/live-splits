"use client";

import { Flag, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setWorkoutFinishedAction } from "@/app/actions/workouts";
import { Button } from "@/components/ui";

/**
 * "End workout" while it's on; "Reopen" after. Ending is undoable, so one tap does it, unless times are
 * flagged to check: then the first tap says so, and a second ends it anyway.
 */
export function WorkoutFinishButton({ workoutId, finished, toCheck = 0 }: { workoutId: string; finished: boolean; toCheck?: number }) {
  const [warned, setWarned] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (value: boolean) =>
    start(async () => {
      const r = await setWorkoutFinishedAction(workoutId, value);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  return (
    <>
      <Button
        variant={warned ? "gold" : "secondary"}
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!finished && toCheck > 0 && !warned) return setWarned(true);
          setWarned(false);
          set(!finished);
        }}
      >
        {finished ? <RotateCcw className="size-3.5" /> : <Flag className="size-3.5" />}
        {finished ? "Reopen" : warned ? `${toCheck} to check · end anyway` : "End workout"}
      </Button>
      {error && <span className="text-[13px] text-danger">{error}</span>}
    </>
  );
}
