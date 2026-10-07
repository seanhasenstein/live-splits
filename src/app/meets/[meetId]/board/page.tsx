import { redirect } from "next/navigation";

/** The live results page used to live at /board; old links and bookmarks still work. */
export default async function BoardRedirect({ params, searchParams }: PageProps<"/meets/[meetId]/board">) {
  const { meetId } = await params;
  const { race } = await searchParams;
  redirect(`/meets/${meetId}/results${typeof race === "string" ? `?race=${race}` : ""}`);
}
