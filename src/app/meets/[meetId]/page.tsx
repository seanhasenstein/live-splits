import type { Metadata } from "next";
import { Download, Pencil, Plus, Users } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { CodesPanel } from "@/components/codes-panel";
import { GunPanel } from "@/components/gun-panel";
import { SessionMenu } from "@/components/session-menu";
import {
  AnchorButton,
  AppHeader,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkButton,
  Page,
  PageTitle,
} from "@/components/ui";
import { can, getSession, isSchoolCoach } from "@/lib/auth/session";
import { getMeet, getProgram, listRaces, readJoinCodes } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { formatLocalDate, formatTimeOfDay } from "@/lib/time";

export async function generateMetadata({ params }: PageProps<"/meets/[meetId]">): Promise<Metadata> {
  const meet = await getMeet((await params).meetId);
  return { title: meet?.name ?? "Meet" };
}

export default async function MeetPage({ params }: PageProps<"/meets/[meetId]">) {
  const { meetId } = await params;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "view", meet)) notFound();

  const [races, program, venue, distances] = await Promise.all([
    listRaces(meet._id),
    getProgram(meet.schoolId, "xc"),
    meet.venueId ? collection(await getDb(), "venues").findOne({ _id: meet.venueId }) : null,
    collection(await getDb(), "distances").find({ sport: "xc" }).toArray(),
  ]);
  const setup = can(session, "setup", meet);
  const gun = can(session, "gun", meet);
  const label = (list: { id: string; label: string }[] | undefined, id: string) => list?.find((x) => x.id === id)?.label ?? id;

  return (
    <>
      <AppHeader
        back={isSchoolCoach(session) ? { href: "/meets", label: "Meets" } : undefined}
        right={<SessionMenu name={session.name} role={isSchoolCoach(session) ? "coach" : session.role} />}
      />
      <Page>
        <PageTitle title={meet.name} description={`${formatLocalDate(meet.date)}${venue ? ` · ${venue.name}${venue.city ? `, ${venue.city}` : ""}` : ""}`} />

        {races.length > 0 && (
          <div className="mb-5 grid grid-cols-2 gap-2">
            {can(session, "tap", meet) && (
              <LinkButton href={`/meets/${meet._id}/tap`} size="lg">
                Tap screen
              </LinkButton>
            )}
            <LinkButton href={`/meets/${meet._id}/board`} size="lg" variant="secondary" className={can(session, "tap", meet) ? "" : "col-span-2"}>
              Live board
            </LinkButton>
          </div>
        )}

        <Card className="mb-5">
          <CardHeader
            title="Races"
            action={
              setup ? (
                <LinkButton href={`/meets/${meet._id}/races/new`} size="sm" variant="secondary">
                  <Plus className="size-4" />
                  Add race
                </LinkButton>
              ) : undefined
            }
          />
          {races.length === 0 ? (
            <div className="border-t border-line">
              <EmptyState
                icon={<Users />}
                title="No races yet"
                description={setup ? "Add each race on the schedule and pick who runs." : "The coach hasn't set up races yet."}
                action={setup ? <LinkButton href={`/meets/${meet._id}/races/new`} size="sm">Add race</LinkButton> : undefined}
              />
            </div>
          ) : (
            races.map((race) => (
              <CardBody key={race._id} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-semibold text-ink">{race.name}</span>
                      {race.scheduledStart && <span className="tnum text-sm text-ink-2">{formatTimeOfDay(race.scheduledStart)}</span>}
                    </div>
                    <div className="mt-0.5 text-[13px] text-ink-2">
                      {label(program?.settings.raceCategories, race.raceCategoryId)} · {race.levelIds.map((l) => label(program?.settings.levels, l)).join(" + ")} ·{" "}
                      {distances.find((d) => d._id === race.distanceId)?.label ?? race.distanceId} · {race.lineup.length} athletes ·{" "}
                      {race.checkpoints.map((c) => c.label).join(", ") || "no checkpoints"}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {can(session, "export", meet) && (
                      <AnchorButton href={`/api/meets/${meet._id}/export?race=${race._id}`} variant="ghost" size="sm" title="Download CSV">
                        <Download className="size-4" />
                        CSV
                      </AnchorButton>
                    )}
                    {setup && (
                      <LinkButton href={`/meets/${meet._id}/races/${race._id}`} variant="ghost" size="sm" title="Edit race">
                        <Pencil className="size-4" />
                        Edit
                      </LinkButton>
                    )}
                  </div>
                </div>
                <GunPanel raceId={race._id} gunTimeMs={race.gunTimeMs} timeZone={meet.timeZone} canGun={gun} />
              </CardBody>
            ))
          )}
        </Card>

        {can(session, "export", meet) && (
          <Card>
            <CardHeader title="Join codes" description="Managers join with the manager code; the viewer link is read-only." />
            <CardBody>
              <CodesPanel meetId={meet._id} initialCodes={readJoinCodes(meet)} canRegenerate={setup} />
            </CardBody>
          </Card>
        )}
      </Page>
    </>
  );
}
