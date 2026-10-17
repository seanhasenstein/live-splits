import { redirect } from "next/navigation";
import { getSession, isSchoolCoach, isWorkoutManager } from "@/lib/auth/session";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/join");
  if (isWorkoutManager(session)) redirect("/workouts");
  if (isSchoolCoach(session) || !session.meetId) redirect("/meets");
  redirect(`/meets/${session.meetId}`);
}
