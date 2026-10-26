"use client";

import { Loader2, Mail, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { adminFindRecipients, adminStartSupportEmail } from "@/lib/support/actions";
import type { SupportRecipient } from "@/lib/support/chat";
import { cn } from "@/lib/utils";

/**
 * "New email" in the admin Support inbox (owner, 2026-10-26: "admin can send support email to users even if they
 * didn't start a support message … with the support@frenzsave.com mail and the Frenz support template").
 *
 * Pick a member by @handle, name or email — or type any email address — then a subject and a message. It goes out
 * from support@frenzsave.com in the Frenz email template; to a member it also opens their Support conversation (they
 * can answer in the app), so it appears in the list beside the others.
 *
 * The member search asks the server only after typing pauses (350 ms) and from two characters — never per keystroke.
 */
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(s.trim());

export function SupportCompose({ onClose, onSent }: { onClose: () => void; onSent: (threadId: string | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SupportRecipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [to, setTo] = useState<{ kind: "member"; member: SupportRecipient } | { kind: "email"; email: string } | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (to) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const t = window.setTimeout(async () => {
      setSearching(true);
      const found = await adminFindRecipients(q).catch(() => []);
      if (mine !== seq.current) return;
      setResults(found);
      setSearching(false);
    }, 350);
    return () => window.clearTimeout(t);
  }, [query, to]);

  const send = async () => {
    if (!to || sending) return;
    setSending(true);
    setError(null);
    const res = await adminStartSupportEmail({ ...(to.kind === "member" ? { userId: to.member.id } : { email: to.email }), subject, body });
    setSending(false);
    if (!res.ok) return setError(res.error);
    setDone(res.to);
    onSent(res.threadId);
  };

  const name = (m: SupportRecipient) => m.displayName || (m.handle ? `@${m.handle}` : m.email || "Member");
  const typedEmail = looksLikeEmail(query) && !results.some((r) => r.email?.toLowerCase() === query.trim().toLowerCase());

  if (done) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
          <Mail className="h-6 w-6" />
        </span>
        <p className="text-sm font-bold">Email sent to {done}</p>
        <p className="text-xs text-muted-foreground">From support@frenzsave.com. Replies reach the support inbox.</p>
        <button type="button" onClick={onClose} className="mt-2 rounded-full bg-secondary px-4 py-2 text-xs font-semibold transition active:scale-95">
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-bold">New email</p>
        <span className="text-xs text-muted-foreground">from support@frenzsave.com</span>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">To</label>
          {to ? (
            <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-background px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {to.kind === "member" ? `${name(to.member)}${to.member.email ? ` · ${to.member.email}` : ""}` : to.email}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{to.kind === "member" ? "member" : "email only"}</span>
              <button type="button" onClick={() => setTo(null)} aria-label="Change recipient" className="rounded-full p-1 text-muted-foreground transition hover:bg-secondary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="@handle, name or email address"
                className="h-11 w-full rounded-2xl border border-border/70 bg-background px-4 text-sm outline-none ring-primary/40 transition focus:ring-2"
              />
              {searching ? <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Searching…</p> : null}
              {results.length > 0 || typedEmail ? (
                <ul className="mt-2 overflow-hidden rounded-2xl border border-border/60">
                  {results.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => setTo({ kind: "member", member: m })} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-secondary/60">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white">
                          {m.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.avatarUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            name(m).replace(/^@/, "").charAt(0).toUpperCase()
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{name(m)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{[m.handle ? `@${m.handle}` : null, m.email].filter(Boolean).join(" · ") || "no email on file"}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {typedEmail ? (
                    <li>
                      <button type="button" onClick={() => setTo({ kind: "email", email: query.trim() })} className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-secondary/60", results.length > 0 && "border-t border-border/60")}>
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          Send to <span className="font-semibold">{query.trim()}</span>
                        </span>
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">Subject</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={150}
            placeholder="What it's about"
            className="h-11 w-full rounded-2xl border border-border/70 bg-background px-4 text-sm outline-none ring-primary/40 transition focus:ring-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            rows={8}
            placeholder="Write your message…"
            className="w-full resize-y rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm leading-relaxed outline-none ring-primary/40 transition focus:ring-2"
          />
          <p className="mt-1 px-1 text-[11px] text-muted-foreground">Sent in the Frenz email template. A member also gets it in their Support chat, with a push.</p>
        </div>
      </div>

      <div className="border-t border-border/60 p-3">
        {error ? <p className="mb-2 px-1 text-xs font-medium text-rose-600">{error}</p> : null}
        <button
          type="button"
          onClick={() => void send()}
          disabled={!to || !subject.trim() || !body.trim() || sending}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-semibold text-white shadow-md transition active:scale-[0.99] disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {sending ? "Sending…" : "Send email"}
        </button>
      </div>
    </div>
  );
}
