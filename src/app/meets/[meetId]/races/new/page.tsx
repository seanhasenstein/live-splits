import type { Metadata } from "next";
import { RaceSetup } from "@/components/race-setup";

export const metadata: Metadata = { title: "New race" };

export default async function NewRacePage({ params }: PageProps<"/meets/[meetId]/races/new">) {
  const { meetId } = await params;
  return <RaceSetup meetId={meetId} raceId={null} />;
}
