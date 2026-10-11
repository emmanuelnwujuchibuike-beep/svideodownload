"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { networkPost } from "@/features/network/shared";
import { GLASS, primaryPill } from "@/features/friends/ui";
import { haptic } from "@/lib/motion/haptics";
import { OPPORTUNITY_KINDS, type OpportunityKind } from "@/lib/social/professional/engine";
import { cn } from "@/lib/utils";

const FIELD = "min-h-[2.75rem] w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/** Post an opportunity (Feature 19 · Part 12). The button answers on the tap; the list refreshes once, after the save. */
export function OpportunityForm({ ready }: { ready: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<OpportunityKind>("job");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [remote, setRemote] = useState(false);
  const [link, setLink] = useState("");
  const [state, setState] = useState<{ sending: boolean; msg: string | null; error: boolean }>({ sending: false, msg: null, error: false });
  return (
    <form
      id="post"
      className={cn("scroll-mt-20 space-y-2 rounded-[22px] p-3", GLASS)}
      onSubmit={async (e) => {
        e.preventDefault();
        haptic("selection");
        setState({ sending: true, msg: null, error: false });
        const out = await networkPost({ op: "opportunity", kind, title, description: description || null, location: location || null, remote, link: link || null });
        if (out.error) return setState({ sending: false, msg: out.error, error: true });
        setTitle("");
        setDescription("");
        setLocation("");
        setLink("");
        setState({ sending: false, msg: "Posted. People who are open to it can find it now.", error: false });
        // the one place a refresh is right: the list below must include what was just posted
        router.refresh();
      }}
    >
      <p className="text-[14px] font-semibold">Post an opportunity</p>
      <label className="block">
        <span className="sr-only">Kind</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as OpportunityKind)} className={FIELD} disabled={!ready}>
          {(Object.keys(OPPORTUNITY_KINDS) as OpportunityKind[]).map((k) => (
            <option key={k} value={k}>
              {OPPORTUNITY_KINDS[k]}
            </option>
          ))}
        </select>
      </label>
      <input aria-label="Title" required minLength={3} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Product designer" className={FIELD} disabled={!ready} />
      <textarea aria-label="Description" rows={3} maxLength={1500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it is, and who it's for" className={cn(FIELD, "resize-y py-2")} disabled={!ready} />
      <div className="grid gap-2 min-[420px]:grid-cols-2">
        <input aria-label="Location" maxLength={80} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" className={FIELD} disabled={!ready} />
        <input aria-label="Link" type="url" maxLength={300} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https:// link (optional)" className={FIELD} disabled={!ready} />
      </div>
      <label className="flex min-h-[2.75rem] items-center gap-2 px-1 text-[14px]">
        <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" disabled={!ready} /> Remote is fine
      </label>
      <button type="submit" className={cn(primaryPill, "w-full justify-center")} disabled={!ready || state.sending || title.trim().length < 3}>
        {state.sending ? "Posting…" : "Post"}
      </button>
      {state.msg ? <p className={cn("text-[13px]", state.error ? "font-medium text-rose-600" : "text-muted-foreground")}>{state.msg}</p> : null}
    </form>
  );
}
