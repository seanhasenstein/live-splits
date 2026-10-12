"use client";

import { Flag, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setWorkoutFinishedAction } from "@/app/actions/workouts";
import { Button } from "@/components/ui";

/** "End workout" while it's on; "Reopen" after. Ending is undoable, so one tap does it. */
export function WorkoutFinishButton({ workoutId, finished }: { workoutId: string; finished: boolean }) {
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
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => set(!finished)}>
        {finished ? <RotateCcw className="size-3.5" /> : <Flag className="size-3.5" />}
        {finished ? "Reopen" : "End workout"}
      </Button>
      {error && <span className="text-[13px] text-danger">{error}</span>}
    </>
  );
}
