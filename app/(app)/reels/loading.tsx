import { Loader2 } from "lucide-react";

/** Full-screen dark placeholder for /reels while the first page loads. */
export default function ReelsLoading() {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black text-white/80" aria-hidden>
      <Loader2 className="h-7 w-7 animate-spin" />
    </div>
  );
}
