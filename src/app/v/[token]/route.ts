import { redirect } from "next/navigation";
import { hashToken } from "@/lib/auth/crypto";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";

/** Read-only viewer link: opening it starts a viewer session for the meet. */
export async function GET(_request: Request, { params }: RouteContext<"/v/[token]">) {
  const { token } = await params;
  const meet = await collection(await getDb(), "meets").findOne({
    "joinCodes.viewerTokenHash": hashToken(token),
    deletedAt: null,
  });
  if (!meet) return new Response("This viewer link is no longer valid.", { status: 404 });
  await createSession({ schoolId: meet.schoolId, meetId: meet._id, role: "viewer", name: "Viewer" });
  redirect(`/meets/${meet._id}`);
}
