"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Unmute a creator (used in the Trust Dashboard's muted-creators list). */
export function UnmuteButton({ targetId }: { targetId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const unmute = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/mute/${targetId}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={unmute}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-secondary disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Unmute
    </button>
  );
}
