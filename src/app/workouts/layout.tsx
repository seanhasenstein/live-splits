import { getSession } from "@/lib/auth/session";
import { TimePrecisionProvider } from "@/lib/client/time-format";
import { getProgram } from "@/lib/data";

/** Workout pages show rep times the team's way (whole seconds or tenths); the running clocks stay at tenths. */
export default async function WorkoutsLayout({ children }: LayoutProps<"/workouts">) {
  const session = await getSession();
  const program = session ? await getProgram(session.schoolId, "xc") : null;
  return <TimePrecisionProvider precision={program?.settings.timePrecision ?? "tenths"}>{children}</TimePrecisionProvider>;
}
