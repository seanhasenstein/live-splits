import { notFound, redirect } from "next/navigation";
import { deleteRaceAction, saveRaceAction } from "@/app/actions/races";
import { RaceForm } from "@/components/race-form";
import { Button, Page } from "@/components/ui";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getProgram, getRace, listDistances, listRoster } from "@/lib/data";

/** Server side of the race form, shared by the new and edit pages. */
export async function RaceSetup({ meetId, raceId }: { meetId: string; raceId: string | null }) {
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "setup", meet)) notFound();
  const race = raceId ? await getRace(raceId) : null;
  if (raceId && (!race || race.meetId !== meet._id)) notFound();

  const program = await getProgram(meet.schoolId, "xc");
  if (!program) notFound();
  const [distances, roster] = await Promise.all([listDistances("xc"), listRoster(meet.seasonId)]);

  return (
    <Page title={race ? race.name : "New race"} back={{ href: `/meets/${meet._id}`, label: meet.name }}>
      <RaceForm
        action={saveRaceAction.bind(null, meet._id, race?._id ?? null)}
        program={program.settings}
        distances={distances.map((d) => ({ id: d._id, label: d.label, value: d.value, unit: d.unit }))}
        roster={roster.map((a) => ({ id: a._id, name: a.displayName, gender: a.gender, defaultLevelId: a.defaultLevelId }))}
        race={
          race && {
            name: race.name,
            raceCategoryId: race.raceCategoryId,
            levelIds: race.levelIds,
            distanceId: race.distanceId ?? distances[0]?._id ?? "",
            scheduledStart: race.scheduledStart,
            checkpoints: race.checkpoints.map((c) => ({ id: c.id, label: c.label, value: c.distance.value, unit: c.distance.unit, kind: c.kind })),
            lineup: race.lineup,
          }
        }
      />
      {race && (
        <form action={deleteRaceAction.bind(null, race._id)} className="mt-8 border-t border-green/20 pt-4">
          <Button variant="danger" type="submit" className="px-3 py-1.5 text-xs">
            Delete race
          </Button>
        </form>
      )}
    </Page>
  );
}
