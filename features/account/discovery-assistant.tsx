"use client";

import { Loader2, Send, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useAssistant } from "@/features/assistant/use-assistant";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Suggest a new interest for me",
  "Summarize what's trending right now",
  "Recommend a creator to follow",
  "Any new sounds I'd like?",
];

/**
 * Smart Discovery Assistant (Feature 15 Part 8) — embedded, not the global
 * floating widget (features/assistant/assistant-widget.tsx). Reuses the same
 * `useAssistant` hook and Claude-backed /api/assistant route that already
 * powers general support chat — just scoped with real `context` (see
 * lib/social/discovery-assistant-context.ts) so it can answer discovery
 * questions grounded in the viewer's ACTUAL data instead of inventing one.
 * Per the project's standing "Smart, never AI" naming rule.
 */
export function DiscoveryAssistant({ context }: { context: string }) {
  const [input, setInput] = useState("");
  const { messages, pending, error, send } = useAssistant(context);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    void send(text);
  };

  const ask = (q: string) => {
    if (pending) return;
    void send(q);
  };

  return (
    <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Discovery Assistant</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Ask about your interests, what&apos;s trending, or who to follow next — answers are grounded in your
        real activity, never made up.
      </p>

      {messages.length === 0 ? (
        <div className="space-y-2">
          {SUGGESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => ask(q)}
              className="flex w-full items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left text-sm transition hover:border-primary/40 hover:bg-secondary/60"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">{q}</span>
            </button>
          ))}
        </div>
      ) : (
        <div ref={scrollRef} className="mb-3 max-h-72 space-y-3 overflow-y-auto">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  m.role === "user"
                    ? "rounded-br-md bg-primary text-primary-foreground"
                    : "rounded-bl-md bg-secondary text-foreground",
                )}
              >
                {m.content}
              </div>
            </div>
          ))}
          {pending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
            </div>
          ) : null}
          {error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p> : null}
        </div>
      )}

      <form onSubmit={submit} className="mt-3 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about discovery…"
          aria-label="Message"
          className="h-11 flex-1 rounded-xl bg-background px-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 active:scale-95 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
