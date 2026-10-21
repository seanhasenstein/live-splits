import type { Metadata } from "next";
import { ClipboardList, ExternalLink, ListOrdered, MapPin, Pencil, Plus, TableProperties, Timer, Upload, UserRound, Users } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { ShareMeet } from "@/components/share-meet";
import { RaceCard, type RaceState } from "@/components/race-card";
import { SessionMenu } from "@/components/session-menu";
import {
  AppHeader,
  Card,
  CardHeader,
  EmptyState,
  ListRow,
  LinkButton,
  LiveDot,
  Page,
  PageTitle,
} from "@/components/ui";
import { can, getSession, isSchoolCoach, isSchoolWide } from "@/lib/auth/session";
import { getMeet, getProgram, gunFiredBy, listRaces, readJoinCodes } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { formatLocalDateLong, formatTimeOfDay } from "@/lib/time";

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
  const [program, venue, course, distances, firedBy] = await Promise.all([
    getProgram(meet.schoolId, "xc"),
    meet.venueId ? collection(await getDb(), "venues").findOne({ _id: meet.venueId }) : null,
    meet.courseId ? collection(await getDb(), "courses").findOne({ _id: meet.courseId }) : null,
    collection(await getDb(), "distances").find({ sport: "xc" }).toArray(),
    gunFiredBy(races.map((r) => r._id)),
  ]);
  const setup = can(session, "setup", meet);
  const staff = can(session, "tap", meet);
  const gun = can(session, "gun", meet);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: meet.timeZone }).format(new Date());
  const base = `/meets/${meet._id}/reports`;
  const results = { href: `${base}/results`, icon: <ListOrdered />, title: "Results", description: `${meet.publicResults ? "Shared publicly · " : ""}Team scores, every team's runners, the whole field` };
  const splits = { href: `${base}/splits`, icon: <TableProperties />, title: "Meet splits", description: "Our runners' splits, bests and letter points" };
  const raceDay = { href: `${base}/race-day`, icon: <ClipboardList />, title: "Race day sheet", description: "A page per race with the lineup, for the clipboard at the mile marks" };
  const previews = { href: `${base}/previews`, icon: <UserRound />, title: "Previews", description: "A page for each runner, looking back from this meet" };
  const onCourse = { href: `${base}/on-this-course`, icon: <MapPin />, title: "On this course", description: "Every earlier race we've run here" };
  const label = (list: { id: string; label: string }[] | undefined, id: string) => list?.find((x) => x.id === id)?.label ?? id;

  return (
    <>
      <AppHeader
        back={isSchoolWide(session) ? { href: "/meets", label: "Meets" } : undefined}
        right={<SessionMenu name={session.name} role={isSchoolCoach(session) ? "coach" : session.role} />}
      />
      <Page>
        <AutoRefresh everyMs={races.some((r) => r.gunTimeMs !== null && !r.finishedAt) ? 5000 : 30000} />
        <PageTitle
          title={meet.name}
          description={`${formatLocalDateLong(meet.date)}${venue ? ` · ${venue.name}${venue.city ? `, ${venue.city}` : ""}` : ""}${
            course && venue && course.name !== venue.name ? ` · ${course.name}` : ""
          }`}
          action={
            <div className="flex gap-1">
              {meet.resultsUrl && (
                <a href={meet.resultsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2">
                  Official timing
                  <ExternalLink className="size-3.5 text-ink-2" />
                </a>
              )}
              {isSchoolWide(session) && (
                <LinkButton href={`/meets/${meet._id}/reports/race-day`} variant="secondary" size="sm" title="Race day sheet" aria-label="Race day sheet">
                  <ClipboardList className="size-4" />
                  <span className="max-sm:sr-only">Race day sheet</span>
                </LinkButton>
              )}
              {can(session, "export", meet) && <ShareMeet meetId={meet._id} codes={readJoinCodes(meet)} canRegenerate={setup} />}
              {setup && (
                <LinkButton href={`/meets/${meet._id}/edit`} variant="secondary" size="sm" title="Edit meet" aria-label="Edit meet">
                  <Pencil className="size-4" />
                  Edit
                </LinkButton>
              )}
            </div>
          }
        />

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
                  // The public sees the race; coaches and managers also the lineup size and checkpoints.
                  details={[
                    label(program?.settings.raceCategories, race.raceCategoryId),
                    race.levelIds.map((l) => label(program?.settings.levels, l)).join(" + "),
                    distances.find((d) => d._id === race.distanceId)?.label ?? race.distanceId,
                    ...(staff ? [`${race.lineup.length} athletes`, race.checkpoints.map((c) => c.label).join(", ") || "no checkpoints"] : []),
                  ].join(" · ")}
                  editHref={setup ? `/meets/${meet._id}/races/${race._id}` : null}
                  csvHref={can(session, "export", meet) ? `/api/meets/${meet._id}/export?race=${race._id}` : null}
                  compareHref={race.officialImportId && can(session, "export", meet) ? `/meets/${meet._id}/compare?race=${race._id}` : null}
                  gunTimeMs={race.gunTimeMs}
                  liveFeed={race.liveFeed ?? null}
                  places={staff ? (race.places ?? null) : null}
                  staff={staff}
                  finishedAt={race.finishedAt?.toISOString() ?? null}
                  // Who fired the gun is staff information: not even sent to the public.
                  firedBy={staff ? (firedBy[race._id] ?? null) : null}
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
                            variant={state === "in_progress" ? "danger-solid" : state === "finished" ? "subtle" : "ink"}
                          >
                            {state === "in_progress" ? <LiveDot className="bg-white" /> : <Timer className="size-4" />}
                            Record splits
                          </LinkButton>
                        )}
                        <LinkButton
                          href={`/meets/${meet._id}/results?race=${race._id}`}
                          size="lg"
                          variant={state === "finished" ? "primary" : "subtle"}
                          className={can(session, "tap", meet) ? "" : "col-span-2"}
                        >
                          <TableProperties className="size-4" />
                          Live results
                        </LinkButton>
                      </div>,
                    ]),
                  ) as Record<RaceState, React.ReactNode>}
                />
              ))}
            </div>
          )}
        </Card>

        {isSchoolWide(session) && (
          <Card id="reports" className="scroll-mt-20">
            <CardHeader title="Reports" description="Each opens on screen, ready to print or save as a PDF" />
            {/* Before the meet, the race-day reports lead; after it, the results. */}
            {(meet.date >= today ? [raceDay, previews, onCourse, results, splits] : [results, splits, raceDay, previews, onCourse]).map((r) => (
              <ListRow key={r.href} href={r.href} icon={r.icon} title={r.title} description={r.description} />
            ))}
          </Card>
        )}
      </Page>
    </>
  );
}
