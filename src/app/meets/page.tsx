import type { Metadata } from "next";
import { CalendarDays, History, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { SectionTabs } from "@/components/section-tabs";
import { SessionMenu } from "@/components/session-menu";
import { ShareSeason } from "@/components/share-season";
import { AppHeader, Badge, Card, EmptyState, LinkButton, LiveDot, Page, PageTitle, SectionLabel } from "@/components/ui";
import { getSession, isSchoolCoach, isSchoolWide } from "@/lib/auth/session";
import { getSchool, listMeets, readSeasonViewerPath } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import type { Meet, Race } from "@/lib/db/schema";
import { formatLocalDate, formatTimeOfDay } from "@/lib/time";

export const metadata: Metadata = { title: "Meets" };

type MeetStatus = "live" | "upcoming" | "past";

/**
 * Live if a race is running on the meet's day (a gun nobody marked finished
 * shouldn't keep last week's meet "live"); upcoming until the date has passed
 * or every race is finished.
 */
function statusOf(meet: Meet, races: Race[], today: string): MeetStatus {
  if (meet.date === today && races.some((r) => r.gunTimeMs !== null && !r.finishedAt)) return "live";
  const allDone = races.length > 0 && races.every((r) => r.finishedAt || r.officialImportId);
  if (allDone || meet.date < today) return "past";
  return "upcoming";
}

export default async function MeetsPage() {
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolWide(session)) redirect(session.meetId ? `/meets/${session.meetId}` : session.role === "manager" ? "/workouts" : "/join");
  const coach = isSchoolCoach(session);

  const [meets, school] = await Promise.all([listMeets(session.schoolId), getSchool(session.schoolId)]);
  const races = await collection(await getDb(), "races")
    .find({ meetId: { $in: meets.map((m) => m._id) }, deletedAt: null })
    .sort({ order: 1 })
    .toArray();
  const racesOf = (m: Meet) => races.filter((r) => r.meetId === m._id);
  // "Today" where the meet is, as a local date string.
  const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const groups: Record<MeetStatus, Meet[]> = { live: [], upcoming: [], past: [] };
  for (const m of meets) groups[statusOf(m, racesOf(m), todayIn(m.timeZone))].push(m);
  groups.upcoming.sort((a, b) => a.date.localeCompare(b.date)); // soonest first; past stays newest first
  const anyLive = groups.live.length > 0;

  const row = (m: Meet, status: MeetStatus) => {
    const rs = racesOf(m);
    const live = rs.filter((r) => r.gunTimeMs !== null && !r.finishedAt);
    const next = rs.find((r) => r.gunTimeMs === null);
    const detail =
      status === "live"
        ? `${live.map((r) => r.name).join(", ")} in progress${next ? ` · ${next.name} next${next.scheduledStart ? ` at ${formatTimeOfDay(next.scheduledStart)}` : ""}` : ""}`
        : status === "upcoming"
          ? rs.length
            ? rs.map((r) => `${r.name}${r.scheduledStart ? ` ${formatTimeOfDay(r.scheduledStart)}` : ""}`).join(" · ")
            : coach
              ? "No races yet"
              : ""
          : rs.some((r) => r.officialImportId)
            ? "Official results"
            : rs.length
              ? `${rs.length} race${rs.length === 1 ? "" : "s"}`
              : "";
    return (
      <a key={m._id} href={`/meets/${m._id}`} className={`flex items-center gap-3 px-4 py-3 ${status === "live" ? "hover:bg-danger-soft" : "hover:bg-surface-2"}`}>
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-md ${status === "live" ? "bg-danger-soft text-danger" : "bg-surface-2 text-ink-2"}`}>
          {status === "live" ? <LiveDot /> : <CalendarDays className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{m.name}</span>
            {status === "live" && (
              <Badge tone="danger" dot pulse>
                Live
              </Badge>
            )}
          </span>
          <span className="block truncate text-[13px] text-ink-2">
            {formatLocalDate(m.date)}
            {detail && ` · ${detail}`}
          </span>
        </span>
      </a>
    );
  };

  return (
    <>
      <AppHeader right={<SessionMenu name={session.name} role={coach ? "coach" : "viewer"} />} />
      <Page>
        <AutoRefresh everyMs={anyLive ? 10000 : 60000} />
        {coach && <SectionTabs active="meets" />}
        <PageTitle
          title="Meets"
          description={school?.name ?? "This season"}
          action={
            coach ? (
              <div className="flex gap-1">
                <ShareSeason initialPath={school ? readSeasonViewerPath(school) : null} />
                <LinkButton href="/meets/new" size="sm">
                  <Plus className="size-4" />
                  New meet
                </LinkButton>
                <LinkButton href="/meets/import-history" size="sm" variant="secondary" aria-label="Import past seasons">
                  <History className="size-4" />
                </LinkButton>
              </div>
            ) : undefined
          }
        />
        {meets.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CalendarDays />}
              title="No meets yet"
              description={coach ? "Create the next meet, add its races, and share the join codes with your managers." : "Check back when the season starts."}
              action={coach ? <LinkButton href="/meets/new" size="sm">New meet</LinkButton> : undefined}
            />
          </Card>
        ) : (
          <div className="space-y-5">
            {(["live", "upcoming", "past"] as const).map((status) =>
              groups[status].length ? (
                <section key={status}>
                  <SectionLabel className="mb-1.5">{status === "live" ? "Happening now" : status === "upcoming" ? "Upcoming" : "Past meets"}</SectionLabel>
                  {/* Happening now gets the running-race tint from the meet page: red means running, on both.
                      overflow-hidden keeps a hovered first or last row inside the rounded corners. */}
                  <Card className={`overflow-hidden ${status === "live" ? "border-danger/40! bg-danger-soft/70!" : ""}`}>
                    <div className={`divide-y ${status === "live" ? "divide-danger/20" : "divide-line"}`}>{groups[status].map((m) => row(m, status))}</div>
                  </Card>
                </section>
              ) : null,
            )}
          </div>
        )}
      </Page>
    </>
  );
}
