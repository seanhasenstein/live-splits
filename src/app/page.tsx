import { APP_NAME } from "@/config/app";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 p-6">
      <h1 className="hairline-title">{APP_NAME}</h1>
      <p className="mt-4 text-sm">Meet setup and join codes arrive in step 2.</p>
    </main>
  );
}
