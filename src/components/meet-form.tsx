"use client";

import { useActionState } from "react";
import { createMeetAction } from "@/app/actions/meets";
import { CodesPanel } from "@/components/codes-panel";
import { Button, ErrorText, Field, Input, LinkButton } from "@/components/ui";

export function MeetForm({ defaultTimeZone, defaultState }: { defaultTimeZone: string; defaultState: string }) {
  const [state, action, pending] = useActionState(createMeetAction, {});

  if (state.created) {
    return (
      <div>
        <p className="mb-4 text-sm">Meet created. Share these with your managers; they stay available on the meet page.</p>
        <CodesPanel meetId={state.created.meetId} initialCodes={state.created.codes} canRegenerate />
        <LinkButton href={`/meets/${state.created.meetId}`} className="mt-4 w-full">
          Set up races
        </LinkButton>
      </div>
    );
  }

  return (
    <form action={action}>
      <Field label="Meet name">
        <Input name="name" placeholder="Nightfall Classic" required maxLength={120} />
      </Field>
      <Field label="Date">
        <Input name="date" type="date" required />
      </Field>
      <Field label="Time zone" hint="IANA name; the meet date and gun times are shown in this zone.">
        <Input name="timeZone" defaultValue={defaultTimeZone} required />
      </Field>
      <Field label="Venue" hint="Optional. Reused if a venue with this name exists.">
        <Input name="venueName" placeholder="Tuscumbia Golf Course" maxLength={120} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="City">
            <Input name="venueCity" placeholder="Green Lake" maxLength={80} />
          </Field>
        </div>
        <Field label="State">
          <Input name="venueState" defaultValue={defaultState} maxLength={2} />
        </Field>
      </div>
      <ErrorText>{state.error}</ErrorText>
      <Button type="submit" disabled={pending} className="w-full py-3.5">
        {pending ? "Creating…" : "Create meet"}
      </Button>
    </form>
  );
}
