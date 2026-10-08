import { redirect } from "next/navigation";
import { hashToken } from "@/lib/auth/crypto";
import { can, createSession, getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";

/** Read-only viewer link: opening it starts a viewer session for the meet. */
export async function GET(_request: Request, { params }: RouteContext<"/v/[token]">) {
  const { token } = await params;
  const meet = await collection(await getDb(), "meets").findOne({
    "joinCodes.viewerTokenHash": hashToken(token),
    deletedAt: null,
  });
  if (meet) {
    // A coach or manager testing the link keeps their session.
    if (!can(await getSession(), "view", meet)) await createSession({ schoolId: meet.schoolId, meetId: meet._id, role: "viewer", name: "Viewer" });
    redirect(`/meets/${meet._id}`);
  }
  // Season-wide link: a viewer session across every meet.
  const school = await collection(await getDb(), "schools").findOne({ "viewerLink.tokenHash": hashToken(token), deletedAt: null });
  if (!school) return new Response("This viewer link is no longer valid.", { status: 404 });
  // A manager or coach checking the link keeps their session (and its rights); a viewer
  // of one meet is upgraded to the season.
  const current = await getSession();
  const keep = current && current.schoolId === school._id && (current.meetId === null || current.role !== "viewer");
  if (!keep) await createSession({ schoolId: school._id, meetId: null, role: "viewer", name: "Viewer" });
  redirect("/meets");
}
