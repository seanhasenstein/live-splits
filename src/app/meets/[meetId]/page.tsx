import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CodesPanel } from "@/components/codes-panel";
import { LeaveButton } from "@/components/leave-button";
import { GunPanel } from "@/components/gun-panel";
import { LinkButton, Page, Section } from "@/components/ui";
import { can, getSession, isSchoolCoach } from "@/lib/auth/session";
import { getMeet, getProgram, listRaces } from "@/lib/data";
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
    <Page title={meet.name} back={isSchoolCoach(session) ? { href: "/meets", label: "Meets" } : undefined}>
      <p className="-mt-3 mb-6 text-sm text-green/70">
        {formatLocalDate(meet.date)}
        {venue && ` · ${venue.name}${venue.city ? `, ${venue.city}` : ""}`}
      </p>

      {races.length > 0 && (
        <div className="mb-6 flex gap-2">
          {can(session, "tap", meet) && (
            <LinkButton href={`/meets/${meet._id}/tap`} className="flex-1 py-4 text-base">
              Tap screen
            </LinkButton>
          )}
          <LinkButton href={`/meets/${meet._id}/board`} variant="secondary" className="flex-1 py-4 text-base">
            Live board
          </LinkButton>
        </div>
      )}

      <Section
        title="Races"
        action={setup ? <LinkButton href={`/meets/${meet._id}/races/new`} className="px-3 py-1.5 text-xs">Add race</LinkButton> : undefined}
      >
        {races.length === 0 && <p className="text-sm text-green/70">No races yet.</p>}
        <ul className="space-y-5">
          {races.map((race) => (
            <li key={race._id}>
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="text-lg font-bold">{race.name}</span>
                  {race.scheduledStart && <span className="ml-2 text-sm text-green/70">{formatTimeOfDay(race.scheduledStart)}</span>}
                </div>
                <span className="flex gap-3 text-sm">
                  {can(session, "export", meet) && (
                    <a href={`/api/meets/${meet._id}/export?race=${race._id}`} className="underline underline-offset-2">
                      CSV
                    </a>
                  )}
                  {setup && (
                    <Link href={`/meets/${meet._id}/races/${race._id}`} className="underline underline-offset-2">
                      Edit
                    </Link>
                  )}
                </span>
              </div>
              <p className="text-sm text-green/70">
                {label(program?.settings.raceCategories, race.raceCategoryId)} ·{" "}
                {race.levelIds.map((l) => label(program?.settings.levels, l)).join(" + ")} ·{" "}
                {distances.find((d) => d._id === race.distanceId)?.label ?? race.distanceId} · {race.lineup.length} athletes ·{" "}
                {race.checkpoints.map((c) => c.label).join(", ") || "no checkpoints"}
              </p>
              <GunPanel raceId={race._id} gunTimeMs={race.gunTimeMs} timeZone={meet.timeZone} canGun={gun} />
            </li>
          ))}
        </ul>
      </Section>

      {setup && (
        <Section title="Join codes">
          <CodesPanel meetId={meet._id} initialCodes={null} />
        </Section>
      )}

      <div className="text-sm text-green/70">
        You&rsquo;re <b>{session.name}</b> ({isSchoolCoach(session) ? "coach" : session.role}).
        {!isSchoolCoach(session) && (
          <LeaveButton />
        )}
      </div>
    </Page>
  );
}
