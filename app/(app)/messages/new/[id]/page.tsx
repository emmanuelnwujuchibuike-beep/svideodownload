import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getOrCreateConversation } from "@/lib/social/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 🔴 Explicit noindex (2026-08-16 SEO audit) — the only page under messages/
// with no robots override; harmless in practice since it only ever
// redirects, but every sibling route declares this explicitly rather than
// relying on it never mattering.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opens (or starts) a conversation with a user, then redirects to the thread.
 * On a gate failure (policy/block) it sends the user back to that profile.
 */
export default async function NewConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: recipientId } = await params;
  if (!UUID.test(recipientId)) redirect("/messages");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/messages/new/${recipientId}`);

  const res = await getOrCreateConversation(user.id, recipientId);
  if (res.ok) redirect(`/messages/${res.id}`);

  // Couldn't start — bounce back to the recipient's profile if we can resolve it.
  // (Resolve the handle BEFORE redirecting; redirect() throws, so keep it out of
  // the try/catch or it'd be swallowed.)
  let handle: string | null = null;
  try {
    const { data } = await createAdminClient().from("profiles").select("handle").eq("id", recipientId).maybeSingle();
    handle = (data?.handle as string | null) ?? null;
  } catch {
    /* ignore */
  }
  redirect(handle ? `/u/${handle}` : "/messages");
}
