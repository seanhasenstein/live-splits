"use client";

import { KeyRound } from "lucide-react";
import { useState, useSyncExternalStore, useTransition } from "react";
import { regenerateWorkoutCodeAction } from "@/app/actions/workouts";
import { CodeRow } from "@/components/codes-panel";
import { Alert, Button } from "@/components/ui";

/**
 * The team's workout code: managers join with it once and can time any
 * workout (not plan, edit or end one, and no meets). Replacing it signs out
 * everyone who joined with the old one.
 */
export function WorkoutCodePanel({ initialCode }: { initialCode: string | null }) {
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const make = () => {
    setConfirming(false);
    start(async () => {
      const r = await regenerateWorkoutCodeAction();
      setError(r.error);
      if (r.code) setCode(r.code);
    });
  };
  return (
    <div className="space-y-3">
      {code ? (
        <div className="rounded-lg border border-line">
          <CodeRow label="Workout code" value={code} note="time any workout" link={`${origin}/join?code=${code}`} />
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={make} disabled={pending}>
          <KeyRound className="size-3.5" />
          {pending ? "Making…" : "Make a workout code"}
        </Button>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {code &&
        (confirming ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <span>Everyone who joined with this code is signed out.</span>
            <Button variant="danger" size="sm" onClick={make}>
              Replace the code
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">
            If it gets out,{" "}
            <button type="button" onClick={() => setConfirming(true)} disabled={pending} className="text-ink-2 underline hover:text-ink">
              {pending ? "working…" : "replace the code"}
            </button>
            .
          </p>
        ))}
    </div>
  );
}
