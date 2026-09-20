import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { CharacterReplaceWorkspace } from "@/features/ai/character-replace/character-replace-workspace";
import { getOwnJob } from "@/lib/ai/job-store";
import { userSubject } from "@/lib/ai/subject";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Video Ready", robots: { index: false, follow: false, nocache: true } };

/**
 * /studio/ai/character-replace/result/[id] — one Character Replace job, as its
 * owner sees it (Part 7 §2, §19, §23–§24, §27).
 *
 * The push notification, the history tile and "Video Ready" all land here.
 * What renders depends on the row: a finished job is the Video Ready
 * viewer; a running one is the processing tracker; a failed one is the
 * failure with its refund state and "Try again"; an expired or deleted one
 * says so. The workspace already knows how to draw every one of those from
 * a job id (it is the same component the push's `?job=` opens), so this
 * page is a door, not a second implementation.
 *
 * ── 🔴 THE OWNERSHIP CHECK IS HERE, ON THE SERVER, AND AGAIN ON EVERY API ─
 *
 * `getOwnJob` reads as the member (RLS + an explicit `user_id` filter): a
 * job that is not theirs — or does not exist — is `notFound()`, the same
 * 404 in both cases so the URL never confirms that somebody else's project
 * id is real. Every fetch the page then makes (`/api/ai/jobs/[id]`,
 * `/result`, `/source`, `/poster`) re-checks ownership on its own; the
 * route protection here is a courtesy, not the control.
 *
 * Signed out: to sign-in, and back here afterwards (§23).
 */
export default async function CharacterReplaceResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) notFound();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/studio/ai/character-replace/result/${id}`)}`);
  const job = await getOwnJob(userSubject(user.id), id);
  if (!job || job.feature !== "ai_character_replace") notFound();

  return (
    <CharacterReplaceWorkspace
      basePath="/studio/ai/character-replace/create"
      modeHref="/studio/ai/character-replace"
      aiHref="/studio/ai"
      historyHref="/studio/ai/history"
      initialJobId={id}
    />
  );
}
