"use client";

import { Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

/** Send-message input for a conversation thread. Refreshes to load the new message. */
export function MessageComposer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body: text }),
      });
      if (res.ok) {
        setBody("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2 border-t border-border/60 bg-background p-3">
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message…"
        aria-label="Message"
        maxLength={2000}
        className="h-11 flex-1 rounded-xl bg-secondary/40 px-4 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
      />
      <button
        type="submit"
        disabled={busy || !body.trim()}
        aria-label="Send"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 active:scale-95 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
    </form>
  );
}
