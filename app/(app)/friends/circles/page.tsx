import { ArrowLeft, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppContent } from "@/features/app-shell/app-content";
import { CirclesManager } from "@/features/friends/circles-manager";
import { ConnectionMapPanel } from "@/features/friends/connection-map-panel";
import { ReconnectStrip } from "@/features/friends/reconnect-strip";
import { graphOverview } from "@/lib/social/graph/overview";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Circles",
  robots: { index: false, follow: false },
};

/**
 * /friends/circles — Social Circles™ and the Connection Map (Part 17).
 *
 * One server read (`graphOverview`) feeds all three panels, so the page costs
 * four queries regardless of how many friends a member has.
 */
export default async function CirclesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/friends/circles");

  const overview = await graphOverview(user.id);

  const initialMembership: Record<string, string[]> = {};
  for (const c of overview.connections) initialMembership[c.user.id] = c.circleIds;

  return (
    <AppContent>
      <div className="mx-auto max-w-2xl pb-24 lg:pb-8">
        <header className="mb-5 flex items-center gap-3">
          <Link
            href="/friends"
            aria-label="Back to friends"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/80 transition hover:bg-secondary"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
              <Users className="h-6 w-6 text-muted-foreground" /> Circles
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Private groups for the people you know. {overview.counts.friends} connection
              {overview.counts.friends === 1 ? "" : "s"}.
            </p>
          </div>
        </header>

        <ReconnectStrip items={overview.reconnect} />

        <div className="mt-5">
          <CirclesManager
            circles={overview.circles}
            connections={overview.connections}
            initialMembership={initialMembership}
          />
        </div>

        <div className="mt-6">
          <h2 className="mb-2 px-0.5 text-sm font-bold">Connection map</h2>
          <ConnectionMapPanel
            connections={overview.connections}
            circles={overview.circles}
            viewerAvatarUrl={overview.viewer?.avatarUrl ?? null}
          />
        </div>
      </div>
    </AppContent>
  );
}
