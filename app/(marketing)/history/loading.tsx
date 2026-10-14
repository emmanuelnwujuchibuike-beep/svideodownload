import { PageLoaderWithHeader } from "@/features/ui/page-loader";

/**
 * /history's fallback while its payload is still on the way — a tap before
 * the prefetch landed (owner, 2026-10-14: "the strip header loader should show
 * when nothing have prefetch"). The page's own header lives in the page, so the
 * fallback draws one, with the stripe under it, on the app's background rather
 * than an empty white screen. A prefetched tap and a cold load never show it:
 * the page is static, so both arrive complete.
 */
export default function Loading() {
  return (
    <div className="min-h-svh bg-background">
      <PageLoaderWithHeader desktop />
    </div>
  );
}
