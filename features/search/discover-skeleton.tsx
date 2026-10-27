import { LoadingStripe } from "@/features/ui/page-loader";

/*
  The Discover screen's loading shape (/search and /explore, design 2026-10-26): title, field, circles, the
  Trending now panel and a row of chips — each block the size of the real one, so nothing jumps when the page
  arrives. Server-only, static fills, no shimmer (the stripe is the one moving thing).
*/
export function DiscoverSkeleton({ title }: { title: string }) {
  return (
    <>
      <LoadingStripe />
      <div aria-hidden className="frenz-ui mx-auto w-full max-w-3xl px-1 pt-[calc(var(--frenz-safe-top)+0.5rem)] lg:pt-2">
        <div className="mb-3.5 flex items-center justify-between">
          <span className="font-heading text-[34px] font-extrabold leading-[1.05] tracking-[-1.2px] text-frenz-ink">{title}</span>
          <span className="h-11 w-11 rounded-full bg-frenz-fill lg:hidden" />
        </div>
        <div className="h-[52px] rounded-[26px] bg-frenz-fill" />
        <div className="mt-4 flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
              <span className="h-[66px] w-[66px] rounded-full bg-frenz-fill" />
              <span className="h-3 w-12 rounded-full bg-frenz-fill" />
            </span>
          ))}
        </div>
        <div className="mt-4 h-[312px] rounded-[32px] bg-frenz-fill" />
        <span className="mb-2.5 mt-[26px] block h-5 w-44 rounded-lg bg-frenz-fill" />
        <div className="flex flex-wrap gap-2">
          {[88, 72, 80, 96, 104].map((w, i) => (
            <span key={i} className="h-11 rounded-full bg-frenz-fill" style={{ width: w }} />
          ))}
        </div>
      </div>
    </>
  );
}

export const SearchLoading = () => <DiscoverSkeleton title="Discover" />;
export const ExploreLoading = () => <DiscoverSkeleton title="Explore" />;
