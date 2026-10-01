import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TapScreen } from "@/components/tap-screen";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, listAthletes, listRaces } from "@/lib/data";

export const metadata: Metadata = { title: "Tap" };

export default async function TapPage({ params, searchParams }: PageProps<"/meets/[meetId]/tap">) {
  const { meetId } = await params;
  const { race: raceParam, cp: cpParam } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "tap", meet)) notFound();

  const races = await listRaces(meet._id);
  const athleteIds = [...new Set(races.flatMap((r) => r.lineup.map((l) => l.athleteId)))];
  const athletes = await listAthletes(meet.schoolId, athleteIds);

  return (
    <TapScreen
      meetId={meet._id}
      initial={{ raceId: typeof raceParam === "string" ? raceParam : null, checkpointId: typeof cpParam === "string" ? cpParam : null }}
      timeZone={meet.timeZone}
      races={races.map((r) => ({
        id: r._id,
        name: r.name,
        gunTimeMs: r.gunTimeMs,
        checkpoints: r.checkpoints.map((c) => ({ id: c.id, label: c.label })),
        athleteIds: r.lineup.map((l) => l.athleteId),
      }))}
      athletes={Object.fromEntries(athletes.map((a) => [a._id, a.displayName]))}
    />
  );
}
