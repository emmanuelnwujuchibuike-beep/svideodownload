"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Unblock a user (used in the blocked-users list). */
export function UnblockButton({ targetId }: { targetId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const unblock = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/block/${targetId}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={unblock}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-secondary disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Unblock
    </button>
  );
}
