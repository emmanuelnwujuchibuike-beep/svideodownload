import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { LipSyncWorkspace } from "@/features/ai/lip-sync/lip-sync-workspace";
import { getOwnJob } from "@/lib/ai/job-store";
import { userSubject } from "@/lib/ai/subject";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Video Ready", robots: { index: false, follow: false, nocache: true } };

/**
 * /studio/ai/lip-sync/result/[id] — one Lip Sync Pro job as its owner sees
 * it: the push, the history tile and "Video Ready" land here. Ownership is
 * checked on the server (a stranger's id is a 404, the same as a missing one)
 * and again by every API the page then calls.
 */
export default async function LipSyncResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) notFound();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/studio/ai/lip-sync/result/${id}`)}`);
  const job = await getOwnJob(userSubject(user.id), id);
  if (!job || job.feature !== "ai_lip_sync") notFound();
  return <LipSyncWorkspace basePath="/studio/ai/lip-sync" aiHref="/studio/ai" historyHref="/studio/ai/history" usageHref="/studio/ai/usage" initialJobId={id} />;
}
