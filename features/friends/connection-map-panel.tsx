"use client";

import { Loader2, Network } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import type { GraphConnection } from "@/lib/social/graph/overview";
import type { CircleRow } from "@/lib/social/graph/store";

/**
 * The Connection Map's loader.
 *
 * The map itself is the heaviest thing on this page and the least likely to be
 * the reason someone opened it — they came to sort people into circles. So it
 * is `import()`ed on tap rather than shipped with the route, which is the
 * pattern the header-widget lesson established: an always-mounted visual
 * component rides first-load even when it renders nothing.
 *
 * `ssr: false` is safe HERE and only here: this is a leaf inside an already
 * client-rendered, force-dynamic page reached by tapping a button — not a
 * layout or navigation component, where `ssr: false` has been shown never to
 * resolve in this app.
 */
const ConnectionMap = dynamic(() => import("@/features/friends/connection-map").then((m) => m.ConnectionMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-40 items-center justify-center rounded-3xl border border-border/70 bg-card">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  ),
});

export function ConnectionMapPanel({
  connections,
  circles,
  viewerAvatarUrl,
}: {
  connections: GraphConnection[];
  circles: CircleRow[];
  viewerAvatarUrl: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (connections.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
        Your map appears once you have friends.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-3 text-left shadow-sm transition hover:bg-secondary/40"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
          <Network className="h-[19px] w-[19px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Show your connection map</span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {connections.length} connection{connections.length === 1 ? "" : "s"}, arranged by how much you&apos;re in
            touch. Only you can see it.
          </span>
        </span>
      </button>
    );
  }

  return <ConnectionMap connections={connections} circles={circles} viewerAvatarUrl={viewerAvatarUrl} />;
}
