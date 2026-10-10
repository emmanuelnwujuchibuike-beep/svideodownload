"use client";

import { ArrowLeft, BookUser, Check, ClipboardPaste, FileUp, Loader2, Lock, Mail, MessageCircle, MessageSquare, Send, Share2, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { FollowChip } from "@/features/friends/discover";
import { AmbientWash, GLASS, GlassGroup, PersonAvatar, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { attributionLink, shareOrCopy } from "@/lib/referrals/share-client";
import { hashEmail } from "@/lib/social/contacts/hash";
import {
  type DeviceContact,
  inviteHref,
  type InviteChannel,
  inviteMessage,
  MATCH_BATCH,
  mergeContacts,
  parseCsv,
  parsePastedContacts,
  parseVcf,
} from "@/lib/social/contacts/normalize";
import type { ContactPerson, FindableByEmail } from "@/lib/social/contacts/server";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Find friends from your contacts (Feature 19 · Part 5).
 *
 *   · Contacts are read ON THIS DEVICE (the Contact Picker where the browser
 *     has one, a .vcf/.csv export, or pasted addresses) and never uploaded.
 *     Only the SHA-256 of each normalised e-mail address is sent, in batches of
 *     500. The database keys it with a secret, compares, and keeps nothing for
 *     a hash that matched nobody (migration 0220).
 *   · Matches are remembered ONLY if the member switches that on, and can be
 *     forgotten in one tap.
 *   · Everyone else becomes an invite the device sends itself (mail, SMS,
 *     WhatsApp, Telegram) with the member's one attribution link.
 *   · "Who can find me by e-mail" sits on the same page, because the person
 *     syncing is exactly the person who should be thinking about it.
 */

type FoundRow = { contact: DeviceContact; person: ContactPerson };

// The Contact Picker API (Chrome on Android). Not in the TS DOM lib yet.
type PickerContact = { name?: string[]; email?: string[]; tel?: string[] };
type ContactsManager = { select: (props: string[], opts: { multiple: boolean }) => Promise<PickerContact[]> };
function picker(): ContactsManager | null {
  const n = typeof navigator !== "undefined" ? (navigator as Navigator & { contacts?: ContactsManager }) : null;
  return n?.contacts && "ContactsManager" in window ? n.contacts : null;
}

const INVITE_PAGE = 30;

export function ContactsFinder({ viewerName }: { viewerName: string | null }) {
  const [contacts, setContacts] = useState<DeviceContact[] | null>(null);
  const [read, setRead] = useState(0);
  const [found, setFound] = useState<FoundRow[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [showInvites, setShowInvites] = useState(INVITE_PAGE);
  const [hasPicker, setHasPicker] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setHasPicker(!!picker()), []);

  const run = async (list: DeviceContact[], rawCount: number) => {
    const merged = mergeContacts(list);
    setContacts(merged);
    setRead(rawCount);
    setFound([]);
    setError(null);
    setShowInvites(INVITE_PAGE);
    // hash on the device, keyed back to the contact it came from
    const byHash = new Map<string, DeviceContact>();
    for (const c of merged) for (const e of c.emails) byHash.set(await hashEmail(e), c);
    const hashes = [...byHash.keys()];
    if (!hashes.length) return;
    setProgress({ done: 0, total: hashes.length });
    const rows: FoundRow[] = [];
    for (let i = 0; i < hashes.length; i += MATCH_BATCH) {
      const batch = hashes.slice(i, i + MATCH_BATCH);
      try {
        const res = await fetch("/api/contacts/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hashes: batch, remember }) });
        const j = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; error?: string; matches?: { h: string; person: ContactPerson }[] } | null;
        if (!res.ok || !j?.ok) {
          const why = j?.reason ?? j?.error;
          setError(
            why === "daily_limit" ? "You’ve checked the most contacts allowed today. The rest can be checked tomorrow."
            : why === "slow_down" ? "That was a lot at once. Wait a minute, then try again."
            : why === "not_ready" ? "Contact matching isn’t switched on yet. Invites below still work."
            : "Couldn’t check your contacts right now. Invites below still work.",
          );
          break;
        }
        for (const m of j.matches ?? []) {
          const c = byHash.get(m.h);
          if (c && !rows.some((r) => r.person.id === m.person.id)) rows.push({ contact: c, person: m.person });
        }
        setFound([...rows]);
      } catch {
        setError("Couldn’t reach Frenz. Check your connection. Invites below still work.");
        break;
      } finally {
        setProgress({ done: Math.min(hashes.length, i + batch.length), total: hashes.length });
      }
    }
    setProgress(null);
  };

  const fromPicker = async () => {
    const p = picker();
    if (!p) return;
    try {
      const picked = await p.select(["name", "email", "tel"], { multiple: true });
      const list = picked.map((c) => ({ key: "", name: c.name?.[0] ?? "", emails: c.email ?? [], phones: c.tel ?? [] }));
      // re-run each through the same parser so normalisation is identical to the other sources
      void run(mergeContacts(list.flatMap((c) => parsePastedContacts([...c.emails, ...c.phones].join("\n")).map((x) => ({ ...x, name: c.name || x.name })))), picked.length);
    } catch {
      /* the member closed the picker */
    }
  };

  const fromFile = async (file: File) => {
    const text = await file.text();
    const list = /\.vcf$/i.test(file.name) || /BEGIN:VCARD/i.test(text.slice(0, 200)) ? parseVcf(text) : parseCsv(text);
    const raw = /BEGIN:VCARD/i.test(text) ? (text.match(/BEGIN:VCARD/gi)?.length ?? list.length) : Math.max(list.length, text.split(/\r?\n/).length - 1);
    if (!list.length) setError("No e-mail addresses or phone numbers were found in that file.");
    else void run(list, raw);
  };

  const fromPaste = () => {
    const list = parsePastedContacts(paste);
    if (!list.length) setError("Paste e-mail addresses or phone numbers, one per line or separated by commas.");
    else {
      setPasteOpen(false);
      void run(list, list.length);
    }
  };

  const matchedKeys = useMemo(() => new Set(found.map((f) => f.contact.key)), [found]);
  const toInvite = useMemo(() => (contacts ?? []).filter((c) => !matchedKeys.has(c.key)), [contacts, matchedKeys]);
  const busy = progress !== null;

  return (
    <div className="relative isolate">
      <AmbientWash />

      <header className="mb-4 flex items-start gap-2 pt-1">
        <Link href="/friends/discover" aria-label="Back to Add friends" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-[clamp(1.6rem,7vw,2rem)] font-extrabold leading-none tracking-[-0.04em]">Your contacts</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">See who’s already on Frenz, and invite the rest.</p>
        </div>
      </header>

      {/* What happens to a contact, in plain words, before anything is read */}
      <div className={cn("mb-5 rounded-[22px] p-4", GLASS)}>
        <p className="flex items-center gap-2 text-[14px] font-semibold">
          <ShieldCheck className="h-[18px] w-[18px] text-emerald-600 dark:text-emerald-400" aria-hidden /> Your contacts stay on this device
        </p>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-snug text-muted-foreground">
          <li>· Each e-mail address is turned into a one-way code here, and only that code is checked.</li>
          <li>· Codes that match nobody are thrown away. Names and numbers are never sent.</li>
          <li>· People who chose not to be found won’t appear.</li>
        </ul>
      </div>

      {/* Sources */}
      <div className="mb-3 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        {hasPicker ? (
          <button type="button" disabled={busy} onClick={() => void fromPicker()} className={cn(primaryPill, "justify-center min-[400px]:col-span-2")}>
            <BookUser className="h-4 w-4" aria-hidden /> Choose from my contacts
          </button>
        ) : null}
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={cn(hasPicker ? quietPill : primaryPill, "justify-center")}>
          <FileUp className="h-4 w-4" aria-hidden /> Import a contacts file
        </button>
        <button type="button" disabled={busy} onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen} className={cn(quietPill, "justify-center")}>
          <ClipboardPaste className="h-4 w-4" aria-hidden /> Paste addresses
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".vcf,.csv,text/vcard,text/x-vcard,text/csv"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void fromFile(f);
          }}
        />
      </div>
      {!hasPicker ? (
        <p className="mb-3 px-1 text-[12px] leading-snug text-muted-foreground">
          On iPhone: Contacts app → Lists → All Contacts → hold → Export, or export a .vcf from Google, Apple or Outlook Contacts.
        </p>
      ) : null}

      {pasteOpen ? (
        <div className={cn("mb-3 rounded-[22px] p-3", GLASS)}>
          <label htmlFor="contacts-paste" className="sr-only">
            E-mail addresses or phone numbers
          </label>
          <textarea
            id="contacts-paste"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={4}
            placeholder={"amaka@example.com\nChris <chris@example.com>\n+234 801 234 5678"}
            className="w-full resize-y rounded-2xl bg-black/[0.03] p-3 text-base outline-none ring-1 ring-black/[0.06] focus:ring-2 focus:ring-primary/40 dark:bg-white/[0.04] dark:ring-white/10"
          />
          <button type="button" onClick={fromPaste} disabled={!paste.trim()} className={cn(primaryPill, "mt-2")}>
            Check these
          </button>
        </div>
      ) : null}

      <label className="mb-5 flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-1 py-2">
        <span className="min-w-0">
          <span className="block text-[14px] font-medium">Remember matches</span>
          <span className="block text-[12.5px] leading-snug text-muted-foreground">Keep who you found (not your contacts) for suggestions later.</span>
        </span>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" />
      </label>

      {progress ? (
        <div className="mb-5" role="status" aria-live="polite">
          <p className="mb-1.5 flex items-center gap-2 px-1 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking {progress.done.toLocaleString()} of {progress.total.toLocaleString()} addresses…
          </p>
          <div className={cn("h-2 overflow-hidden rounded-full", GLASS)}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mb-5 rounded-2xl bg-amber-500/10 px-3.5 py-2.5 text-[13px] text-amber-800 dark:text-amber-300">
          {error}
        </p>
      ) : null}

      {contacts ? (
        <>
          {/* Contact Health: real counts from this run, nothing estimated */}
          <dl className={cn("mb-5 grid grid-cols-3 divide-x divide-black/[0.06] overflow-hidden rounded-[22px] text-center dark:divide-white/[0.07]", GLASS)}>
            {[
              ["Read", read],
              ["On Frenz", found.length],
              ["To invite", toInvite.length],
            ].map(([label, n]) => (
              <div key={label} className="px-2 py-3">
                <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 text-[20px] font-bold tabular-nums">{formatCompactNumber(Number(n))}</dd>
              </div>
            ))}
          </dl>
          {read > contacts.length ? (
            <p className="-mt-3 mb-5 px-1 text-[12px] text-muted-foreground">
              {(read - contacts.length).toLocaleString()} duplicate or empty entr{read - contacts.length === 1 ? "y was" : "ies were"} merged or skipped.
            </p>
          ) : null}

          {found.length ? (
            <section className="mb-6" aria-labelledby="contacts-on-frenz">
              <SectionHeader id="contacts-on-frenz" title="On Frenz" count={found.length} />
              <GlassGroup label="Contacts on Frenz">
                {found.map(({ contact, person }) => (
                  <FoundRowView key={person.id} contact={contact} person={person} />
                ))}
              </GlassGroup>
            </section>
          ) : !busy && !error ? (
            <p className="mb-6 px-1 text-[13.5px] text-muted-foreground">None of these contacts are on Frenz yet, or they chose not to be found. Invite them below.</p>
          ) : null}

          {toInvite.length ? (
            <section className="mb-6" aria-labelledby="contacts-invite">
              <SectionHeader id="contacts-invite" title="Invite to Frenz" count={toInvite.length} />
              <GlassGroup label="Contacts to invite">
                {toInvite.slice(0, showInvites).map((c) => (
                  <InviteRow key={c.key} contact={c} viewerName={viewerName} />
                ))}
              </GlassGroup>
              {toInvite.length > showInvites ? (
                <button type="button" onClick={() => setShowInvites((n) => n + INVITE_PAGE)} className={cn(quietPill, "mx-auto mt-3 flex")}>
                  Show {Math.min(INVITE_PAGE, toInvite.length - showInvites)} more
                </button>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      <SavedMatches />
      <FindablePrivacy />
    </div>
  );
}

function FoundRowView({ contact, person }: FoundRow) {
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5">
      <Link href={`/u/${person.handle}`} prefetch={false} className="shrink-0" aria-label={person.displayName}>
        <PersonAvatar user={person} size={52} />
      </Link>
      <Link href={`/u/${person.handle}`} prefetch={false} className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[15px] font-semibold">{person.displayName}</span>
          {person.isVerified ? <VerifiedTick size="sm" className="h-[15px] w-[15px] shrink-0" /> : null}
        </span>
        {/* the contact's name is the DEVICE's own data, shown back to the person who owns it */}
        <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
          {contact.name && contact.name !== contact.key && contact.name.toLowerCase() !== person.displayName.toLowerCase() ? `Saved as “${contact.name}”` : `In your contacts · @${person.handle}`}
        </span>
      </Link>
      <FollowChip id={person.id} name={person.displayName} initial={person.isFollowing} source="contacts" />
    </li>
  );
}

let linkPromise: Promise<string> | null = null;
function inviteLink(): Promise<string> {
  linkPromise ??= attributionLink("app", "app").then((u) => u ?? window.location.origin);
  return linkPromise;
}

function InviteRow({ contact, viewerName }: { contact: DeviceContact; viewerName: string | null }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const go = async (channel: InviteChannel | "more") => {
    const link = await inviteLink();
    if (channel === "more") {
      // the native share sheet: Signal, Telegram, Messenger, anything the device has
      const out = await shareOrCopy(link, inviteMessage(link, viewerName));
      if (out === "shared" || out === "copied") setSent(out === "copied" ? "Link copied" : "Invite shared");
      return;
    }
    const href = inviteHref(channel, contact, link, viewerName);
    if (!href) return;
    setSent("Invite opened");
    if (href.startsWith("http")) window.open(href, "_blank", "noopener,noreferrer");
    else window.location.href = href;
  };
  const channels: { key: InviteChannel | "more"; label: string; icon: React.ReactNode }[] = [
    ...(contact.emails.length ? [{ key: "email" as const, label: "E-mail", icon: <Mail className="h-4 w-4" aria-hidden /> }] : []),
    ...(contact.phones.length ? [{ key: "sms" as const, label: "SMS", icon: <MessageSquare className="h-4 w-4" aria-hidden /> }] : []),
    { key: "whatsapp", label: "WhatsApp", icon: <MessageCircle className="h-4 w-4" aria-hidden /> },
    { key: "telegram", label: "Telegram", icon: <Send className="h-4 w-4" aria-hidden /> },
    { key: "more", label: "More…", icon: <Share2 className="h-4 w-4" aria-hidden /> },
  ];
  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <PersonAvatar user={{ displayName: contact.name, avatarUrl: null }} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold">{contact.name}</p>
          <p className="truncate text-[12px] text-muted-foreground">{sent ?? contact.emails[0] ?? contact.phones[0]}</p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`Invite ${contact.name}`} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[13px] text-primary")}>
          {sent ? <Check className="h-4 w-4" aria-hidden /> : null} Invite
        </button>
      </div>
      {open ? (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-14" role="group" aria-label={`Ways to invite ${contact.name}`}>
          {channels.map((c) => (
            <button key={c.key} type="button" onClick={() => void go(c.key)} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/** Matches the member chose to remember, re-filtered by today's privacy settings, with "Forget all". */
function SavedMatches() {
  const [people, setPeople] = useState<ContactPerson[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetch("/api/contacts/matches")
      .then((r) => (r.ok ? r.json() : { people: [] }))
      .then((j: { people?: ContactPerson[] }) => alive && setPeople(j.people ?? []))
      .catch(() => alive && setPeople([]));
    return () => {
      alive = false;
    };
  }, []);
  if (!people?.length) return null;
  const forget = async () => {
    const prev = people;
    setPeople([]);
    const res = await fetch("/api/contacts/matches", { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setPeople(prev);
  };
  return (
    <section className="mb-6" aria-labelledby="contacts-saved">
      <SectionHeader
        id="contacts-saved"
        title="Remembered from contacts"
        count={people.length}
        action={
          confirm ? (
            <button type="button" onClick={() => void forget()} className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full bg-rose-600 px-3 text-[12.5px] font-semibold text-white">
              <Trash2 className="h-4 w-4" aria-hidden /> Forget all
            </button>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className="text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">
              Forget
            </button>
          )
        }
      />
      <GlassGroup label="Remembered contact matches">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <PersonAvatar user={p} size={44} />
            <Link href={`/u/${p.handle}`} prefetch={false} className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">
              {p.displayName}
            </Link>
            <FollowChip id={p.id} name={p.displayName} initial={p.isFollowing} source="contacts" />
          </li>
        ))}
      </GlassGroup>
    </section>
  );
}

const FINDABLE: { key: FindableByEmail; label: string }[] = [
  { key: "everyone", label: "Anyone" },
  { key: "friends_of_friends", label: "Friends of friends" },
  { key: "nobody", label: "Nobody" },
];

/** Contact Privacy: who may find ME from an address in THEIR contacts. */
function FindablePrivacy() {
  const [value, setValue] = useState<FindableByEmail | null>(null);
  const [ready, setReady] = useState(true);
  useEffect(() => {
    void fetch("/api/contacts/privacy")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { findableByEmail?: FindableByEmail | null; ready?: boolean } | null) => {
        setValue(j?.findableByEmail ?? "everyone");
        setReady(j?.ready !== false);
      })
      .catch(() => setValue("everyone"));
  }, []);
  const choose = async (next: FindableByEmail) => {
    const prev = value;
    setValue(next);
    const res = await fetch("/api/contacts/privacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ findableByEmail: next }) }).catch(() => null);
    if (!res?.ok) setValue(prev);
  };
  return (
    <section className="mb-4" aria-labelledby="contacts-privacy">
      <SectionHeader id="contacts-privacy" title="Who can find you by e-mail" />
      <div className={cn("rounded-[22px] p-3.5", GLASS)}>
        <div role="radiogroup" aria-labelledby="contacts-privacy" className="grid grid-cols-3 gap-1 rounded-full bg-black/[0.04] p-1 dark:bg-white/[0.06]">
          {FINDABLE.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={value === o.key}
              disabled={!ready || value === null}
              onClick={() => void choose(o.key)}
              className={cn(
                "min-h-[2.5rem] rounded-full px-2 text-[12.5px] font-semibold transition",
                value === o.key ? "bg-white text-foreground shadow-sm dark:bg-white/15" : "text-muted-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="mt-2.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {value === "nobody"
            ? "No one can find you from their contacts. People can still search your name or @handle."
            : value === "friends_of_friends"
              ? "Only people who share a friend with you can find you from their contacts."
              : "People who already have your e-mail address in their contacts can find you. Your address is never shown."}
        </p>
      </div>
    </section>
  );
}
