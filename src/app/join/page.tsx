import type { Metadata } from "next";
import { JoinForm } from "@/components/join-form";
import { Shield } from "@/components/ui";
import { APP_NAME } from "@/config/app";

export const metadata: Metadata = { title: "Join" };

export default async function JoinPage({ searchParams }: PageProps<"/join">) {
  const { code } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-6 flex flex-col items-center text-center">
        <Shield className="h-16" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-ink-2">Enter the code your coach shared and your first name.</p>
      </div>
      <JoinForm initialCode={typeof code === "string" ? code : ""} />
      <p className="mt-6 text-center text-[13px] text-ink-3">
        Coaches: the meet&rsquo;s coach code opens fix and export; the school&rsquo;s coach access code opens meet setup.
      </p>
    </main>
  );
}
