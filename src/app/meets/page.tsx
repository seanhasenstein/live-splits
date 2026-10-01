import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { leaveAction } from "@/app/actions/auth";
import { Button, LinkButton, Page, Section } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { listMeets } from "@/lib/data";
import { formatLocalDate } from "@/lib/time";

export const metadata: Metadata = { title: "Meets" };

export default async function MeetsPage() {
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolCoach(session)) redirect(session.meetId ? `/meets/${session.meetId}` : "/join");

  const meets = await listMeets(session.schoolId);
  return (
    <Page title="Meets">
      <Section title="This season" action={<LinkButton href="/meets/new" className="px-3 py-1.5 text-xs">New meet</LinkButton>}>
        {meets.length === 0 ? (
          <p className="text-sm text-green/70">No meets yet.</p>
        ) : (
          <ul className="divide-y divide-green/20">
            {meets.map((m) => (
              <li key={m._id}>
                <Link href={`/meets/${m._id}`} className="flex items-baseline justify-between py-3 hover:bg-green/5">
                  <span className="font-bold">{m.name}</span>
                  <span className="text-sm text-green/70">{formatLocalDate(m.date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <div className="text-sm text-green/70">
        Signed in as <b>{session.name}</b> (coach).{" "}
        <form action={leaveAction} className="inline">
          <Button variant="secondary" type="submit" className="ml-2 px-2 py-1 text-xs">
            Leave
          </Button>
        </form>
      </div>
    </Page>
  );
}
