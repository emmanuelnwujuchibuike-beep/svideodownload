"use client";

import { Loader2, Send, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useAssistant } from "@/features/assistant/use-assistant";
import { cn } from "@/lib/utils";

/**
 * Creator Assistant (Feature 15 · Part 9).
 *
 * Named "Creator Assistant", not "AI Creator Assistant" — standing naming rule
 * on this project is "Smart, never AI". Same hook and same /api/assistant route
 * that already power support chat and the Discovery Assistant; the only
 * difference is the `context`, which here is a block of this creator's own
 * measured numbers (see lib/creator/assistant-context.ts).
 *
 * Nothing it says is applied automatically. Every suggestion is a sentence a
 * creator can act on or ignore, which is what "everything optional" in the
 * brief has to mean for a tool that talks about somebody's own work.
 */

const SUGGESTIONS = [
  "When should I post next?",
  "Which of my topics is working best?",
  "Why is my watch-through dropping?",
  "What should I make this week?",
];

export function CreatorAssistant({ context }: { context: string }) {
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

  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Creator Assistant</h2>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        Ask about your own performance. Answers are grounded in your real numbers — it is told what it may
        reference and cannot invent a figure it wasn&apos;t given.
      </p>

      {messages.length === 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => !pending && void send(q)}
              disabled={pending}
              className="rounded-2xl border border-border/70 bg-secondary/30 px-3.5 py-2.5 text-left text-xs font-medium transition hover:border-primary/40 hover:bg-secondary/60 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="max-h-80 space-y-3 overflow-y-auto pr-1"
          role="log"
          aria-live="polite"
          aria-label="Assistant conversation"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed",
                m.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-foreground",
              )}
            >
              {m.content}
            </div>
          ))}
          {pending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              Thinking
            </div>
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      <form onSubmit={submit} className="mt-4 flex items-center gap-2">
        <label htmlFor="creator-assistant-input" className="sr-only">
          Ask the Creator Assistant
        </label>
        <input
          id="creator-assistant-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your performance"
          maxLength={2000}
          className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="submit"
          disabled={pending || input.trim().length === 0}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </section>
  );
}
