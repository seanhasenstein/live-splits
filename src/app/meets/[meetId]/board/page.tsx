import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Board } from "@/components/board";
import { can, getSession, isSchoolCoach } from "@/lib/auth/session";
import { getMeet, listAthletes, listRaces } from "@/lib/data";

export const metadata: Metadata = { title: "Live board" };

export default async function BoardPage({ params, searchParams }: PageProps<"/meets/[meetId]/board">) {
  const { meetId } = await params;
  const { race } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "view", meet)) notFound();

  const races = await listRaces(meet._id);
  const athleteIds = [...new Set(races.flatMap((r) => r.lineup.map((l) => l.athleteId)))];
  const athletes = await listAthletes(meet.schoolId, athleteIds);

  return (
    <Board
      meetId={meet._id}
      meetName={meet.name}
      session={{ name: session.name, role: isSchoolCoach(session) ? "coach" : session.role }}
      initialRaceId={typeof race === "string" ? race : null}
      timeZone={meet.timeZone}
      races={races.map((r) => ({
        id: r._id,
        name: r.name,
        gunTimeMs: r.gunTimeMs,
        finished: !!r.finishedAt,
        checkpoints: r.checkpoints.map((c) => ({ id: c.id, label: c.label, meters: c.distance.meters, kind: c.kind })),
        athleteIds: r.lineup.map((l) => l.athleteId),
      }))}
      athletes={Object.fromEntries(athletes.map((a) => [a._id, a.displayName]))}
      canFix={can(session, "fix", meet)}
      canTap={can(session, "tap", meet)}
    />
  );
}
