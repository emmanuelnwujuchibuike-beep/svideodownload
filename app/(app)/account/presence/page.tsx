import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PresenceSettings } from "@/features/account/presence-settings";
import { SettingsPage } from "@/features/account/settings-page";
import { getOwnPresence } from "@/lib/social/presence/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Presence", robots: { index: false, follow: false } };

/**
 * /account/presence — status, focus modes, automations and who sees them
 * (Feature 19 · Part 9). Everything shown is read from the stores that enforce
 * it (0043 + 0224, 0060), so this screen cannot disagree with what others see.
 */
export default async function PresencePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/presence");
  const own = await getOwnPresence(user.id);
  return (
    <SettingsPage title="Presence" description="How you appear, and to whom. Nothing changes unless you change it." bare>
      <PresenceSettings initial={own} userId={user.id} />
    </SettingsPage>
  );
}
