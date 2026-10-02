"use client";

import { useActionState } from "react";
import { createMeetAction } from "@/app/actions/meets";
import { CodesPanel } from "@/components/codes-panel";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, LinkButton } from "@/components/ui";

export function MeetForm({ defaultTimeZone, defaultState }: { defaultTimeZone: string; defaultState: string }) {
  const [state, action, pending] = useActionState(createMeetAction, {});

  if (state.created) {
    return (
      <Card>
        <CardHeader title="Meet created" description="Share these with your managers. They stay available on the meet page." />
        <CardBody>
          <CodesPanel meetId={state.created.meetId} initialCodes={state.created.codes} canRegenerate />
          <LinkButton href={`/meets/${state.created.meetId}`} className="mt-4 w-full">
            Set up races
          </LinkButton>
        </CardBody>
      </Card>
    );
  }

  return (
    <form action={action}>
      <Card>
        <CardBody className="space-y-4 border-t-0">
          <Field label="Meet name">
            <Input name="name" placeholder="Nightfall Classic" required maxLength={120} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input name="date" type="date" required />
            </Field>
            <Field label="Time zone">
              <Input name="timeZone" defaultValue={defaultTimeZone} required />
            </Field>
          </div>
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
          {state.error && <Alert tone="danger">{state.error}</Alert>}
        </CardBody>
        <CardBody className="flex justify-end gap-2 py-3">
          <LinkButton href="/meets" variant="secondary">
            Cancel
          </LinkButton>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create meet"}
          </Button>
        </CardBody>
      </Card>
    </form>
  );
}
