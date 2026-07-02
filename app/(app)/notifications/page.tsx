import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppContent } from "@/features/app-shell/app-content";
import { NotificationCenter } from "@/features/notifications/notification-center";
import { listGroupedNotifications } from "@/lib/social/notifications";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function NotificationsPage() {
  if (!hasSupabase) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/notifications");

  // Seed the grouped list server-side so the center paints instantly, then the
  // client revalidates + subscribes to realtime.
  const initial = await listGroupedNotifications(user.id, 80);

  return (
    <AppContent>
      <div className="mx-auto max-w-2xl">
        <NotificationCenter initial={initial} />
      </div>
    </AppContent>
  );
}
