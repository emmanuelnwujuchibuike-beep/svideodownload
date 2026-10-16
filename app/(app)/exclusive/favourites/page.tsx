import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FavouritesList } from "@/features/sub/favourites-list";
import { listFavourites } from "@/lib/sub/favourites";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Favourite creators", robots: { index: false, follow: false } };

/** /exclusive/favourites — the member's own favourite creators (Frenz Exclusive Part 6). */
export default async function FavouritesRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/exclusive/favourites");
  const first = await listFavourites(user.id);
  return (
    <div className="mx-auto w-full max-w-xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <header className="mb-4 flex items-center gap-2 px-1">
        <Link href="/exclusive" aria-label="Back to Exclusive" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Favourite creators</h1>
          <p className="text-[13.5px] text-muted-foreground">Only you can see this list.</p>
        </div>
      </header>
      <FavouritesList initial={first.ok ? { items: first.items, next: first.next } : null} />
    </div>
  );
}
