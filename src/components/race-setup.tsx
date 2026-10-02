import { notFound, redirect } from "next/navigation";
import { deleteRaceAction, saveRaceAction } from "@/app/actions/races";
import { RaceForm } from "@/components/race-form";
import { AppHeader, Button, Page, PageTitle } from "@/components/ui";
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
    <>
      <AppHeader back={{ href: `/meets/${meet._id}`, label: meet.name }} />
      <Page>
        <PageTitle
          title={race ? race.name : "New race"}
          description={race ? "Changes apply to new taps; recorded times keep their checkpoint." : "Checkpoints are where managers stand."}
        />
        <RaceForm
          action={saveRaceAction.bind(null, meet._id, race?._id ?? null)}
          cancelHref={`/meets/${meet._id}`}
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
          <form action={deleteRaceAction.bind(null, race._id)} className="mt-8 flex justify-end">
            <Button variant="danger" size="sm" type="submit">
              Delete race
            </Button>
          </form>
        )}
      </Page>
    </>
  );
}
