"use client";

import { ChevronUp, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

/** Sticky bottom paste-and-download bar — funnels into the Downloads page. */
export function HomeDownloadBar() {
  const router = useRouter();
  const [url, setUrl] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push(url.trim() ? `/downloads?u=${encodeURIComponent(url.trim())}` : "/downloads");
  };

  return (
    <div className="pointer-events-none sticky bottom-4 z-20 mt-4 flex justify-center px-2">
      <form onSubmit={submit} className="pointer-events-auto flex w-full max-w-2xl items-center gap-2 rounded-full border border-border/60 bg-card/95 p-1.5 pl-2 shadow-elevated backdrop-blur-xl">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white"><Download className="h-4 w-4" /></span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste any link here (TikTok, Instagram, X, Facebook…)" aria-label="Paste link" className="min-w-0 flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        <button type="submit" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white"><Download className="h-4 w-4" /> Download</button>
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground sm:flex"><ChevronUp className="h-4 w-4" /></span>
      </form>
    </div>
  );
}
