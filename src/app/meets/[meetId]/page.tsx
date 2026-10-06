import type { Metadata } from "next";
import { Download, GitCompare, Pencil, Plus, Upload, Users } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { CodesPanel } from "@/components/codes-panel";
import { RaceCard, type RaceState } from "@/components/race-card";
import { SessionMenu } from "@/components/session-menu";
import {
  AnchorButton,
  AppHeader,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkButton,
  LiveDot,
  Page,
  PageTitle,
} from "@/components/ui";
import { can, getSession, isSchoolCoach } from "@/lib/auth/session";
import { getMeet, getProgram, gunFiredBy, listRaces, readJoinCodes } from "@/lib/data";
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

  const races = await listRaces(meet._id);
  const [program, venue, distances, firedBy] = await Promise.all([
    getProgram(meet.schoolId, "xc"),
    meet.venueId ? collection(await getDb(), "venues").findOne({ _id: meet.venueId }) : null,
    collection(await getDb(), "distances").find({ sport: "xc" }).toArray(),
    gunFiredBy(races.map((r) => r._id)),
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
        <AutoRefresh everyMs={races.some((r) => r.gunTimeMs !== null && !r.finishedAt) ? 5000 : 30000} />
        <PageTitle title={meet.name} description={`${formatLocalDate(meet.date)}${venue ? ` · ${venue.name}${venue.city ? `, ${venue.city}` : ""}` : ""}`} />

        <Card className="mb-5">
          <CardHeader
            title="Races"
            action={
              <div className="flex gap-1">
                {can(session, "export", meet) && races.length > 0 && (
                  <LinkButton href={`/meets/${meet._id}/import`} size="sm" variant="secondary">
                    <Upload className="size-4" />
                    Import results
                  </LinkButton>
                )}
                {setup && (
                  <LinkButton href={`/meets/${meet._id}/races/new`} size="sm" variant="secondary">
                    <Plus className="size-4" />
                    Add race
                  </LinkButton>
                )}
              </div>
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
            <div className="space-y-3 border-t border-line p-3">
              {races.map((race) => (
                <RaceCard
                  key={race._id}
                  raceId={race._id}
                  name={race.name}
                  startLabel={race.scheduledStart ? formatTimeOfDay(race.scheduledStart) : null}
                  details={`${label(program?.settings.raceCategories, race.raceCategoryId)} · ${race.levelIds.map((l) => label(program?.settings.levels, l)).join(" + ")} · ${
                    distances.find((d) => d._id === race.distanceId)?.label ?? race.distanceId
                  } · ${race.lineup.length} athletes · ${race.checkpoints.map((c) => c.label).join(", ") || "no checkpoints"}`}
                  headerActions={
                    <>
                      {race.officialImportId && can(session, "export", meet) && (
                        <LinkButton href={`/meets/${meet._id}/compare?race=${race._id}`} variant="subtle" size="sm" title="App vs official">
                          <GitCompare className="size-4" />
                        </LinkButton>
                      )}
                      {can(session, "export", meet) && (
                        <AnchorButton href={`/api/meets/${meet._id}/export?race=${race._id}`} variant="subtle" size="sm" title="Download CSV" aria-label="Download CSV">
                          <Download className="size-4" />
                        </AnchorButton>
                      )}
                      {setup && (
                        <LinkButton href={`/meets/${meet._id}/races/${race._id}`} variant="subtle" size="sm" title="Edit race" aria-label="Edit race">
                          <Pencil className="size-4" />
                        </LinkButton>
                      )}
                    </>
                  }
                  gunTimeMs={race.gunTimeMs}
                  finishedAt={race.finishedAt?.toISOString() ?? null}
                  firedBy={firedBy[race._id] ?? null}
                  timeZone={meet.timeZone}
                  canGun={gun}
                  hasOfficial={!!race.officialImportId}
                  actions={Object.fromEntries(
                    (["not_started", "in_progress", "finished"] as const).map((state) => [
                      state,
                      <div key={state} className="grid grid-cols-2 gap-2">
                        {can(session, "tap", meet) && (
                          <LinkButton
                            href={`/meets/${meet._id}/record?race=${race._id}`}
                            size="lg"
                            variant={state === "in_progress" ? "danger-solid" : state === "finished" ? "primary" : "ink"}
                          >
                            {state === "in_progress" && <LiveDot className="bg-white" />}
                            Record splits
                          </LinkButton>
                        )}
                        <LinkButton href={`/meets/${meet._id}/board?race=${race._id}`} size="lg" variant="subtle" className={can(session, "tap", meet) ? "" : "col-span-2"}>
                          Live board
                        </LinkButton>
                      </div>,
                    ]),
                  ) as Record<RaceState, React.ReactNode>}
                />
              ))}
            </div>
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
