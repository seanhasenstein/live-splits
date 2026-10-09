import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Board } from "@/components/board";
import { can, getSession, isSchoolCoach } from "@/lib/auth/session";
import { getMeet, listAthletes, listRaces } from "@/lib/data";
import { getLineupHistory } from "@/lib/results/history";

export const metadata: Metadata = { title: "Live results" };

export default async function ResultsPage({ params, searchParams }: PageProps<"/meets/[meetId]/results">) {
  const { meetId } = await params;
  const { race } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "view", meet)) notFound();

  const races = await listRaces(meet._id);
  const athleteIds = [...new Set(races.flatMap((r) => r.lineup.map((l) => l.athleteId)))];
  const [athletes, histories] = await Promise.all([listAthletes(meet.schoolId, athleteIds), Promise.all(races.map((r) => getLineupHistory(meet, r)))]);

  return (
    <Board
      meetId={meet._id}
      meetName={meet.name}
      session={{ name: session.name, role: isSchoolCoach(session) ? "coach" : session.role }}
      initialRaceId={typeof race === "string" ? race : null}
      timeZone={meet.timeZone}
      races={races.map((r, i) => ({
        id: r._id,
        name: r.name,
        gunTimeMs: r.gunTimeMs,
        finished: !!r.finishedAt,
        checkpoints: r.checkpoints.map((c) => ({ id: c.id, label: c.label, meters: c.distance.meters, kind: c.kind })),
        athleteIds: r.lineup.map((l) => l.athleteId),
        history: histories[i],
      }))}
      athletes={Object.fromEntries(athletes.map((a) => [a._id, a.displayName]))}
      genders={Object.fromEntries(athletes.map((a) => [a._id, a.gender]))}
      canFix={can(session, "fix", meet)}
      canTap={can(session, "tap", meet)}
    />
  );
}
