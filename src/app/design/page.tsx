import type { Metadata } from "next";
import { Clock, Download, Flag, Users } from "lucide-react";
import { SegmentedDemo, SheetDemo, ThemeToggle } from "@/components/design-demos";
import {
  Alert,
  AppHeader,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  ListRow,
  Page,
  PageTitle,
  SectionLabel,
  Select,
  Stat,
  Time,
  Toast,
} from "@/components/ui";

export const metadata: Metadata = { title: "Design system" };

const colors = [
  ["bg", "Page"],
  ["surface", "Surface"],
  ["surface-2", "Surface 2"],
  ["line", "Line"],
  ["line-strong", "Line strong"],
  ["ink", "Ink"],
  ["ink-2", "Ink 2"],
  ["ink-3", "Ink 3"],
  ["brand", "Brand"],
  ["brand-soft", "Brand soft"],
  ["brand-text", "Brand text"],
  ["gold", "Gold"],
  ["gold-soft", "Gold soft"],
  ["gold-text", "Gold text"],
  ["danger", "Danger"],
  ["danger-soft", "Danger soft"],
];

/** Every token and component in one place. Not linked from the app. */
export default function DesignPage() {
  return (
    <>
      <AppHeader title="Design system" subtitle="tokens and components" right={<ThemeToggle />} />
      <Page wide className="space-y-10">
        <section>
          <SectionLabel className="mb-3">Color</SectionLabel>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {colors.map(([token, label]) => (
              <div key={token}>
                <div className="h-12 rounded-md border border-line" style={{ background: `var(--${token})` }} />
                <div className="mt-1 text-xs text-ink-2">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionLabel className="mb-3">Type</SectionLabel>
          <Card>
            <CardBody className="space-y-3 border-t-0">
              <div className="text-2xl font-semibold tracking-tight">Nightfall Classic</div>
              <div className="text-xl font-semibold tracking-tight">Girls · 7:10 PM</div>
              <div className="text-[15px]">Body: Managers tap names as athletes pass each checkpoint.</div>
              <div className="text-sm text-ink-2">Secondary: Tuscumbia Golf Course, Green Lake</div>
              <div className="text-[13px] text-ink-2">Small: recorded by Sean · 2 unsent</div>
              <div className="flex items-baseline gap-6">
                <Time className="text-4xl font-semibold tracking-tight">16:41.8</Time>
                <Time className="text-2xl font-semibold">6:02.4</Time>
                <Time className="text-sm text-ink-2">+1:57.8</Time>
              </div>
            </CardBody>
          </Card>
        </section>

        <section>
          <SectionLabel className="mb-3">Stats (from the PDFs)</SectionLabel>
          <Card>
            <CardBody className="flex gap-8 border-t-0">
              <Stat value="47" label="pts" />
              <Stat value="1st" label="place" tone="brand" />
              <Stat value="9" label="teams" />
              <Stat value="61" label="runners" />
              <Stat value="20:57" label="letter standard" tone="gold" />
            </CardBody>
          </Card>
        </section>

        <section>
          <SectionLabel className="mb-3">Buttons</SectionLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Button>Save race</Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="ghost">Leave</Button>
            <Button variant="danger">Delete</Button>
            <Button variant="gold">Gun</Button>
            <Button disabled>Saving…</Button>
            <Button size="sm" variant="secondary">
              <Download className="size-3.5" />
              CSV
            </Button>
            <Button size="lg">Create meet</Button>
          </div>
        </section>

        <section>
          <SectionLabel className="mb-3">Inputs</SectionLabel>
          <Card>
            <CardBody className="grid gap-4 border-t-0 sm:grid-cols-2">
              <Field label="Meet name" hint="What's on the schedule.">
                <Input placeholder="Nightfall Classic" />
              </Field>
              <Field label="Category">
                <Select defaultValue="girls">
                  <option value="girls">Girls</option>
                  <option value="boys">Boys</option>
                </Select>
              </Field>
              <Field label="Code" error="That code didn't match a meet">
                <Input defaultValue="85J-ZMY" className="font-mono tracking-widest" />
              </Field>
              <div className="flex items-end">
                <Checkbox label="This is an estimate" defaultChecked />
              </div>
            </CardBody>
          </Card>
        </section>

        <section>
          <SectionLabel className="mb-3">Card with rows</SectionLabel>
          <Card>
            <CardHeader title="Races" description="Friday, Oct 2" action={<Button size="sm" variant="secondary">Add race</Button>} />
            <div className="divide-y divide-line border-t border-line">
              <ListRow icon={<Users />} title="Girls" description="Varsity + JV · 5K · 10 athletes" meta="7:10 PM" href="#" />
              <ListRow icon={<Users />} title="Boys" description="Varsity + JV · 5K · 17 athletes" meta="7:45 PM" href="#" />
              <ListRow icon={<Flag />} title="Gun" description="Not started" meta={<Badge tone="gold" dot>Waiting</Badge>} />
              <ListRow icon={<Clock />} title="Clock" meta="+3 ms" />
            </div>
          </Card>
        </section>

        <section>
          <SectionLabel className="mb-3">Badges, alerts, empty state</SectionLabel>
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge dot>Not started</Badge>
            <Badge tone="brand" dot>
              Live
            </Badge>
            <Badge tone="gold">3 unassigned</Badge>
            <Badge tone="danger" dot>
              Offline
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Alert tone="danger" title="Not allowed">
              Only a coach session can create meets.
            </Alert>
            <Alert tone="gold">Set the gun time to see elapsed times.</Alert>
          </div>
          <Card className="mt-3">
            <EmptyState icon={<Flag />} title="No races yet" description="Add the races on tonight's schedule and pick who runs." action={<Button size="sm">Add race</Button>} />
          </Card>
        </section>

        <section>
          <SectionLabel className="mb-3">Table</SectionLabel>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
                  <th className="px-4 py-2 font-semibold">Athlete</th>
                  <th className="px-3 py-2 text-right font-semibold">Mile 1</th>
                  <th className="px-3 py-2 text-right font-semibold">Mile 2</th>
                  <th className="px-4 py-2 text-right font-semibold">Finish</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[
                  ["Eddy Giebler", "5:00.3", "10:36.1", "16:41.8"],
                  ["Titus Gottschalk", "5:19.0", "11:22.4", "17:31.8"],
                  ["Oliver Leibham", "5:23.2", "11:43.0", ""],
                ].map(([n, a, b, c]) => (
                  <tr key={n} className={c ? "" : "text-ink-3"}>
                    <td className="px-4 py-2.5 font-medium text-ink">{n}</td>
                    <td className="px-3 py-2.5 text-right">{a}</td>
                    <td className="px-3 py-2.5 text-right">
                      {b}
                      <span className="block text-[11px] text-ink-3">+5:35.8</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">{c || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>

        <section>
          <SectionLabel className="mb-3">Tap screen pieces</SectionLabel>
          <div className="grid max-w-md grid-cols-2 gap-2">
            <button type="button" className="min-h-20 rounded-lg border border-line bg-surface px-3 py-2 text-left shadow-card active:bg-gold-soft">
              <span className="block text-xl leading-tight font-semibold">Elanore</span>
              <span className="block text-sm text-ink-2">Faucher</span>
            </button>
            <button type="button" className="min-h-20 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left text-ink-3">
              <span className="block text-xl leading-tight font-semibold">Ella</span>
              <span className="block text-sm">Heronymus</span>
              <Time className="block text-sm font-semibold text-ink-2">6:15.3</Time>
            </button>
            <div className="min-h-20 rounded-lg border-2 border-gold bg-gold px-3 py-2 text-left">
              <span className="block text-xl leading-tight font-semibold">Emma</span>
              <span className="block text-sm">Krueger</span>
            </div>
            <button type="button" className="flex min-h-20 items-center justify-center rounded-lg bg-gold text-2xl font-semibold tracking-wide text-ink">
              Capture
            </button>
          </div>
          <div className="mt-3 flex max-w-md items-center gap-2 rounded-lg border border-gold/50 bg-gold-soft px-3 py-2">
            <Badge tone="gold">2 unassigned</Badge>
            <Time className="rounded-md bg-surface px-2 py-0.5 text-sm font-semibold ring-2 ring-gold">6:02.4</Time>
            <Time className="rounded-md bg-surface px-2 py-0.5 text-sm font-semibold">6:02.9</Time>
          </div>
        </section>

        <section>
          <SectionLabel className="mb-3">Segmented, sheet, toast</SectionLabel>
          <div className="flex max-w-md flex-col gap-3">
            <SegmentedDemo />
            <SheetDemo />
            <Toast title="Recorded Emma Krueger 6:02.4" action={<Button size="sm" variant="secondary">Undo</Button>} />
            <Toast tone="danger" title="Offline" description="2 taps waiting to send" />
          </div>
        </section>

        <section>
          <PageTitle title="Page title" description="With a description and an action." action={<Button size="sm">Action</Button>} />
        </section>
      </Page>
    </>
  );
}
