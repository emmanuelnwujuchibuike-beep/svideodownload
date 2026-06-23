"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bot, Loader2, MessageCircle, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  ASSISTANT_GREETING,
  ASSISTANT_SUGGESTIONS,
} from "@/lib/assistant/knowledge";
import { cn } from "@/lib/utils";

import { useAssistant } from "./use-assistant";

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, pending, error, send, reset } = useAssistant();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, pending, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 250);
  }, [open]);

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

  const empty = messages.length === 0;

  return (
    <>
      {/* Launcher */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.6, type: "spring", stiffness: 260, damping: 20 }}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-xl shadow-primary/30 transition-transform hover:scale-105 active:scale-95 sm:bottom-6 sm:right-6"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={open ? "x" : "chat"}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
          </motion.span>
        </AnimatePresence>
        {!open ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-75" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-cyan-400" />
          </span>
        ) : null}
      </motion.button>

      {/* Panel */}
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-h-[70vh] flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-elevated sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-[24rem]"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-r from-blue-600/10 to-cyan-500/10 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-white">
                  <Bot className="h-5 w-5" />
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-semibold">SVideoDownload Assistant</p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Online · usually instant
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {!empty ? (
                  <button
                    type="button"
                    onClick={reset}
                    aria-label="New chat"
                    title="New chat"
                    className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {/* greeting bubble */}
              <Bubble role="assistant">{ASSISTANT_GREETING}</Bubble>

              {empty ? (
                <div className="space-y-2 pt-1">
                  {ASSISTANT_SUGGESTIONS.map((q) => (
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
              ) : null}

              {messages.map((m, i) => (
                <Bubble key={i} role={m.role}>
                  {m.content}
                </Bubble>
              ))}

              {pending ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                </div>
              ) : null}

              {error ? (
                <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">
                  {error}
                </p>
              ) : null}
            </div>

            {/* Input */}
            <form
              onSubmit={submit}
              className="flex items-center gap-2 border-t border-border/60 bg-card p-3"
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything…"
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
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: string }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-secondary text-foreground",
        )}
      >
        {children}
      </div>
    </div>
  );
}
