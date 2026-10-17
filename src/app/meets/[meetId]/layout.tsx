import { TimePrecisionProvider } from "@/lib/client/time-format";
import { getMeet, getProgram } from "@/lib/data";

/** Every meet page shows times the way the team's program says to. */
export default async function MeetLayout({ params, children }: LayoutProps<"/meets/[meetId]">) {
  const { meetId } = await params;
  const meet = await getMeet(meetId);
  const program = meet && (await getProgram(meet.schoolId, "xc"));
  return <TimePrecisionProvider precision={program?.settings.timePrecision ?? "tenths"}>{children}</TimePrecisionProvider>;
}
