import type { Metadata } from "next";
import { JoinForm } from "@/components/join-form";
import { Page } from "@/components/ui";
import { APP_NAME } from "@/config/app";

export const metadata: Metadata = { title: "Join" };

export default function JoinPage() {
  return (
    <Page title={APP_NAME}>
      <p className="mb-2 text-sm">
        <b>Managers:</b> enter the meet code from your coach and your first name. Your name goes on every time you record.
      </p>
      <p className="mb-5 text-sm text-green/70">
        <b>Coaches:</b> the meet&rsquo;s coach code gets you fix and export; the school&rsquo;s coach access code (the
        <code className="mx-1">COACH_ACCESS_CODE</code>setting) gets you meet setup.
      </p>
      <JoinForm />
    </Page>
  );
}
