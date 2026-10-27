import { LoadingStripe } from "@/features/ui/page-loader";

/*
  The Friends routes' loading screens (Friends brief 2026-10-26: "Add loading.tsx skeletons for both routes").
  Server components — no client JS. Each block matches the real section's size and spacing, so nothing jumps
  when the page arrives. Static fills only: no shimmer, no looping animation (the stripe is the one moving thing).
*/

const B = "rounded-full bg-frenz-fill";

function Rows({ n, h = 72 }: { n: number; h?: number }) {
  return (
    <div className="divide-y divide-frenz-line/70 overflow-hidden rounded-[24px] border border-frenz-line bg-frenz-card">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3.5" style={{ height: h }}>
          <span className="h-11 w-11 shrink-0 rounded-full bg-frenz-fill" />
          <span className="flex flex-1 flex-col gap-2">
            <span className={`${B} h-3.5 w-32`} />
            <span className={`${B} h-3 w-24`} />
          </span>
          <span className={`${B} h-9 w-[76px]`} />
        </div>
      ))}
    </div>
  );
}

export function FriendsSkeleton() {
  return (
    <>
      <LoadingStripe />
      <div aria-hidden className="frenz-ui mx-auto w-full max-w-2xl px-3 pt-5 sm:px-4">
        <div className="mb-4 flex items-end justify-between pt-1">
          <span className="flex flex-col gap-2">
            <span className="h-9 w-36 rounded-xl bg-frenz-fill" />
            <span className={`${B} h-3.5 w-40`} />
          </span>
          <span className="h-11 w-11 rounded-full bg-frenz-fill" />
        </div>
        <div className="mb-4 flex gap-3">
          <span className="h-[64px] w-[64px] rounded-full bg-frenz-fill" />
          <span className="h-[64px] flex-1 rounded-[22px] bg-frenz-fill" />
        </div>
        <div className="h-[244px] rounded-[32px] bg-frenz-fill" />
        <div className="mt-3.5 flex gap-2.5">
          <span className="h-[54px] flex-1 rounded-[27px] bg-frenz-fill" />
          <span className="h-[54px] w-[54px] rounded-full bg-frenz-fill" />
        </div>
        <span className="mb-2.5 mt-[26px] block h-5 w-32 rounded-lg bg-frenz-fill" />
        <Rows n={4} h={64} />
      </div>
    </>
  );
}

export function AddFriendsSkeleton() {
  return (
    <>
      <LoadingStripe />
      <div aria-hidden className="frenz-ui mx-auto w-full max-w-2xl px-4 pt-4">
        <div className="flex items-center justify-between">
          <span className={`${B} h-4 w-20`} />
          <span className="h-11 w-11 rounded-full bg-frenz-fill" />
        </div>
        <span className="mt-2 block h-9 w-48 rounded-xl bg-frenz-fill" />
        <span className={`${B} mt-2.5 block h-3.5 w-64`} />
        <div className="mt-4 h-[460px] rounded-[34px] bg-frenz-fill" />
        <div className="mt-4 h-[52px] rounded-[26px] bg-frenz-fill" />
        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          <span className="h-[132px] rounded-[24px] bg-frenz-fill" />
          <span className="h-[132px] rounded-[24px] bg-frenz-fill" />
        </div>
        <span className="mb-2.5 mt-[26px] block h-5 w-44 rounded-lg bg-frenz-fill" />
        <Rows n={4} />
      </div>
    </>
  );
}
