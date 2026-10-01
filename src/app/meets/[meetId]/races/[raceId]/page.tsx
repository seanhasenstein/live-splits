import type { Metadata } from "next";
import { RaceSetup } from "@/components/race-setup";

export const metadata: Metadata = { title: "Edit race" };

export default async function EditRacePage({ params }: PageProps<"/meets/[meetId]/races/[raceId]">) {
  const { meetId, raceId } = await params;
  return <RaceSetup meetId={meetId} raceId={raceId} />;
}
