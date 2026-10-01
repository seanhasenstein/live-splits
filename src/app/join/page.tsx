import type { Metadata } from "next";
import { JoinForm } from "@/components/join-form";
import { Page } from "@/components/ui";
import { APP_NAME } from "@/config/app";

export const metadata: Metadata = { title: "Join" };

export default function JoinPage() {
  return (
    <Page title={APP_NAME}>
      <p className="mb-5 text-sm">Enter the code from your coach and your first name. Your name goes on every time you record.</p>
      <JoinForm />
    </Page>
  );
}
