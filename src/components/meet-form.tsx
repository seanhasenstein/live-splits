"use client";

import { useActionState, useState } from "react";
import { type MeetFormState } from "@/app/actions/meets";
import { CodesPanel } from "@/components/codes-panel";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, LinkButton } from "@/components/ui";
import type { VenueWithCourses } from "@/lib/data";

export type MeetFormValues = {
  name: string;
  date: string;
  timeZone: string;
  venueName: string;
  venueCity: string;
  venueState: string;
  courseId: string | null;
};

type Props = {
  action: (prev: MeetFormState, formData: FormData) => Promise<MeetFormState>;
  venues: VenueWithCourses[];
  defaultTimeZone: string;
  defaultState: string;
  /** Editing an existing meet; null for a new one. */
  meet: MeetFormValues | null;
  cancelHref: string;
};

export function MeetForm({ action, venues, defaultTimeZone, defaultState, meet, cancelHref }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [venueName, setVenueName] = useState(meet?.venueName ?? "");
  const [courseId, setCourseId] = useState(meet?.courseId ?? "");
  const [newCourseName, setNewCourseName] = useState("");

  const venue = venues.find((v) => v.name.trim().toLowerCase() === venueName.trim().toLowerCase());
  const courses = venue?.courses ?? [];
  const year = Number((meet?.date ?? "").slice(0, 4)) || new Date().getFullYear();
  // What the server would pick if the coach says nothing: the venue's current layout.
  const current = [...courses].filter((c) => c.activeToYear === null || c.activeToYear >= year).sort((a, b) => (b.activeFromYear ?? 0) - (a.activeFromYear ?? 0))[0];
  const selected = courseId || current?._id || "";

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

  const courseLabel = (c: VenueWithCourses["courses"][number]) =>
    `${c.name}${c.activeFromYear ? ` · ${c.activeToYear ? `${c.activeFromYear}–${c.activeToYear}` : `since ${c.activeFromYear}`}` : ""}`;

  return (
    <form action={formAction}>
      <input type="hidden" name="courseId" value={selected} />
      <Card>
        <CardBody className="space-y-4 border-t-0">
          <Field label="Meet name">
            <Input name="name" defaultValue={meet?.name} placeholder="Nightfall Classic" required maxLength={120} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input name="date" type="date" defaultValue={meet?.date} required />
            </Field>
            <Field label="Time zone">
              <Input name="timeZone" defaultValue={meet?.timeZone ?? defaultTimeZone} required />
            </Field>
          </div>
          <Field label="Venue" hint={venue ? "A venue you've used before." : "Optional. Reused if a venue with this name exists."}>
            <Input
              name="venueName"
              value={venueName}
              onChange={(e) => {
                setVenueName(e.target.value);
                setCourseId("");
              }}
              list="venue-names"
              placeholder="Tuscumbia Golf Course"
              maxLength={120}
              autoComplete="off"
            />
            <datalist id="venue-names">
              {venues.map((v) => (
                <option key={v._id} value={v.name} />
              ))}
            </datalist>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="City">
                <Input name="venueCity" key={venue?._id ?? "new"} defaultValue={venue?.city ?? meet?.venueCity ?? ""} placeholder="Green Lake" maxLength={80} readOnly={!!venue} />
              </Field>
            </div>
            <Field label="State">
              <Input name="venueState" key={venue?._id ?? "new"} defaultValue={venue?.state ?? meet?.venueState ?? defaultState} maxLength={2} readOnly={!!venue} />
            </Field>
          </div>

          {venueName.trim() && (
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Course</span>
              {courses.length === 0 && selected !== "new" ? (
                <p className="text-[13px] text-ink-2">
                  First meet here: a course record named after the venue is created for you. Course bests and &ldquo;vs this course&rdquo; build on it from now on.{" "}
                  <button type="button" onClick={() => setCourseId("new")} className="text-ink underline">
                    Name it yourself
                  </button>
                </p>
              ) : (
                <div className="grid gap-1.5">
                  {courses.map((c) => {
                    const active = selected === c._id;
                    return (
                      <button
                        key={c._id}
                        type="button"
                        onClick={() => setCourseId(c._id)}
                        className={`flex h-11 items-center justify-between rounded-md border px-3 text-left text-sm ${active ? "border-brand bg-brand-soft text-ink" : "border-line bg-surface text-ink hover:bg-surface-2"}`}
                      >
                        <span>{courseLabel(c)}</span>
                        {c._id === current?._id && <span className="text-xs text-ink-3">current layout</span>}
                      </button>
                    );
                  })}
                  {selected === "new" ? (
                    <div className="rounded-md border border-brand bg-brand-soft p-3">
                      <Field label="New layout" hint="Use this when the route changed; times on different layouts aren't compared.">
                        <Input name="newCourseName" value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} placeholder={`${venueName.trim()} ${year} route`} maxLength={120} autoFocus />
                      </Field>
                      <Button variant="subtle" size="sm" onClick={() => setCourseId("")} className="mt-2">
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button variant="subtle" size="sm" onClick={() => setCourseId("new")} className="justify-self-start">
                      New layout…
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {state.error && <Alert tone="danger">{state.error}</Alert>}
        </CardBody>
        <CardBody className="flex justify-end gap-2 py-3">
          <LinkButton href={cancelHref} variant="secondary">
            Cancel
          </LinkButton>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : meet ? "Save meet" : "Create meet"}
          </Button>
        </CardBody>
      </Card>
    </form>
  );
}
