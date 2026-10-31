"use client";

import { UserCheck, UserPlus, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { StableAvatar } from "@/components/ui/stable-avatar";
import { addFriendAction, cancelFriendAction, skipSuggestionAction } from "@/features/friends/actions";
import { FriendsToast, useFriendsToast } from "@/features/friends/friends-toast";
import { PendingButton, PendingLink } from "@/features/frenz-ui/pending";
import type { PersonSuggestion } from "@/lib/social/people/engine";
import { profilePath } from "@/lib/social/profile-url";
import { cn } from "@/lib/utils";

/**
 * Suggested for you — the Friends redesign's card deck (design/friends, 2026-10-26).
 *
 *   · TAP ONLY. There is no drag, swipe or pointer-gesture code: a card leaves only through Skip or
 *     Add friend. The design's ADD/SKIP badges and "Swipe right…" hint are gone with the gesture.
 *   · Add / Skip are Server Actions (features/friends/actions.ts) inside a transition; useOptimistic
 *     takes the person off the deck on the tap and puts them back, with an error toast, if the server
 *     refuses. Add shows "Friend request sent to {name}" with Undo for 4 s.
 *   · The leaving card fades and slides out — opacity + transform only, var(--dur-deck) — and the next
 *     moves up through the same transition. Reduced motion: no exit, no transition.
 *   · Never more than 3 cards in the DOM (2 under a leaving one). People arrive 10 at a time; the next
 *     10 are fetched when 3 remain — never on mount when the server already sent everything.
 *   · The engine's reason ("1 friend in common", "In your contacts") is shown as it comes. The design's
 *     mutual-friend faces are NOT drawn: the reason never names a private connection, so there are no
 *     faces to show honestly — a person-check glyph stands in.
 */

const PAGE = 10;
const REFILL_AT = 3;

type Op = { type: "remove"; id: string } | { type: "restore"; person: PersonSuggestion };
type Ghost = { person: PersonSuggestion; dir: "add" | "skip"; key: number };

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** How long a card stays in front before its profile is warmed — longer than a skip, so skipping costs nothing. */
const WARM_PROFILE_AFTER_MS = 450;

export function SuggestionDeck({ initial, variant, seeAllHref, onWarmSeeAll }: { initial: PersonSuggestion[]; variant: "panel" | "hero"; seeAllHref?: string; onWarmSeeAll?: () => void }) {
  const [queue, setQueue] = useState<PersonSuggestion[]>(initial);
  const [deck, apply] = useOptimistic(queue, (q: PersonSuggestion[], op: Op) =>
    op.type === "remove" ? q.filter((p) => p.id !== op.id) : [op.person, ...q.filter((p) => p.id !== op.person.id)],
  );
  const [, startTransition] = useTransition();
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [answered, setAnswered] = useState(0);
  const [exhausted, setExhausted] = useState(initial.length < PAGE);
  const [refilling, setRefilling] = useState(false);
  const known = useRef(new Set(initial.map((p) => p.id)));
  const loading = useRef(false);
  const ghostSeq = useRef(0);

  /*
    The front card's profile, warmed (owner, 2026-10-28: "when their profile comes up it should warm up so it doesn't load
    when tapped — and it shouldn't interrupt the smoothness when a user skips"). Only once a card has stayed in front for
    WARM_PROFILE_AFTER_MS, and then at an idle moment: a quick run of skips starts nothing (each skip cancels the pending
    warm-up), so swiping stays smooth. A FULL prefetch — the whole page, kept by the router — so the tap opens it at once.
  */
  const router = useRouter();
  const frontHandle = deck[0]?.handle ?? null;
  useEffect(() => {
    if (!frontHandle) return;
    const href = profilePath(frontHandle);
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let idle: number | null = null;
    const timer = window.setTimeout(() => {
      const go = () => router.prefetch(href, { kind: "full" } as unknown as Parameters<typeof router.prefetch>[1]);
      if (w.requestIdleCallback) idle = w.requestIdleCallback(go, { timeout: 1500 });
      else go();
    }, WARM_PROFILE_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
      if (idle !== null) w.cancelIdleCallback?.(idle);
    };
  }, [frontHandle, router]);
  const { toast, show, hide } = useFriendsToast();

  // the next page when 3 remain — the only fetch this component ever makes on its own
  const refill = useCallback(async (shuffle = false) => {
    if (loading.current) return;
    loading.current = true;
    setRefilling(true);
    try {
      const ex = [...known.current].slice(-100).join(",");
      const q = shuffle ? `&shuffle=1&exclude=${ex}` : ex ? `&exclude=${ex}` : "";
      const res = await fetch(`/api/people/suggestions?filter=all&limit=${PAGE}${q}`);
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { people?: PersonSuggestion[] };
      const people = j.people ?? [];
      const fresh = shuffle ? people : people.filter((p) => !known.current.has(p.id));
      for (const p of fresh) known.current.add(p.id);
      setQueue((cur) => [...cur, ...fresh.filter((p) => !cur.some((c) => c.id === p.id))]);
      setExhausted(people.length < PAGE);
    } catch {
      setExhausted(true); // a failed page ends the deck for this visit rather than retrying in a loop
    } finally {
      loading.current = false;
      setRefilling(false);
    }
  }, []);

  useEffect(() => {
    if (deck.length <= REFILL_AT && !exhausted) void refill();
  }, [deck.length, exhausted, refill]);

  const leave = (person: PersonSuggestion, dir: "add" | "skip") => {
    if (reducedMotion()) return;
    ghostSeq.current += 1;
    setGhost({ person, dir, key: ghostSeq.current });
  };

  const answer = (person: PersonSuggestion, dir: "add" | "skip") => {
    leave(person, dir);
    startTransition(async () => {
      apply({ type: "remove", id: person.id });
      const res = dir === "add" ? await addFriendAction(person.id) : await skipSuggestionAction(person.id);
      if (!res.ok) {
        show(res.error, { tone: "error" });
        return; // nothing committed: the optimistic removal falls away and the person is back on top
      }
      setQueue((q) => q.filter((p) => p.id !== person.id));
      setAnswered((n) => n + 1);
      if (dir === "add") show(`Friend request sent to ${person.displayName}`, { undo: () => undoAdd(person) });
    });
  };

  const undoAdd = (person: PersonSuggestion) => {
    startTransition(async () => {
      apply({ type: "restore", person });
      const res = await cancelFriendAction(person.id);
      if (!res.ok) {
        show(res.error, { tone: "error" });
        return;
      }
      setQueue((q) => [person, ...q.filter((p) => p.id !== person.id)]);
      setAnswered((n) => Math.max(0, n - 1));
    });
  };

  const startOver = () => {
    setExhausted(false);
    void refill(true);
  };

  // ≤3 in the DOM: under a leaving card only 2 more are drawn
  const visible = deck.slice(0, ghost ? 2 : 3);
  const total = answered + deck.length;
  const done = deck.length === 0 && !refilling;
  const step = variant === "hero" ? 14 : 10;

  const stack = (
    <div className={cn("relative", variant === "hero" ? "h-[330px]" : "h-[196px]")}>
      {visible
        .map((p, i) => (
          <div
            key={p.id}
            className="frenz-deck-card absolute inset-x-0 top-0"
            style={{ transform: i === 0 ? "none" : `translateY(${i * step}px) scale(${1 - i * 0.06})`, opacity: i === 0 ? 1 : 1 - i * 0.3, zIndex: 10 - i, transformOrigin: "50% 100%" }}
            aria-hidden={i > 0 || undefined}
            inert={i > 0 || undefined}
          >
            {/* only the front card shows a person; the cards under it are blank tiles, so the next suggestion's avatar and
                name never peek through (owner, 2026-10-31) */}
            {i === 0 ? (
              <Card person={p} variant={variant} front onAdd={() => answer(p, "add")} onSkip={() => answer(p, "skip")} />
            ) : (
              <div className={cn("frenz-glass-tile", variant === "hero" ? "h-[300px] rounded-[30px]" : "h-[172px] rounded-[26px]")} />
            )}
          </div>
        ))
        .reverse()}
      {ghost ? (
        <div
          key={`ghost-${ghost.key}`}
          className={cn("pointer-events-none absolute inset-x-0 top-0 z-20", ghost.dir === "add" ? "frenz-deck-out-add" : "frenz-deck-out-skip")}
          onAnimationEnd={() => setGhost((g) => (g?.key === ghost.key ? null : g))}
          aria-hidden
          inert
        >
          <Card person={ghost.person} variant={variant} front pressed={ghost.dir} onAdd={() => {}} onSkip={() => {}} />
        </div>
      ) : null}
      {done ? (
        <div className={cn("frenz-glass-tile absolute inset-x-0 top-0 flex flex-col items-center justify-center gap-2.5 rounded-[26px] px-6 text-center text-frenz-ink", variant === "hero" ? "h-[300px]" : "h-[172px]")}>
          <span className="font-heading text-[18px] font-bold">You&apos;re all caught up</span>
          {variant === "hero" ? <span className="text-[14px] text-frenz-muted">New suggestions show up as your network grows.</span> : null}
          <PendingButton pending={refilling} onClick={startOver} className="h-11 rounded-full bg-frenz-gradient-x px-4 text-[14px] font-extrabold text-white">
            Show suggestions again
          </PendingButton>
        </div>
      ) : deck.length === 0 ? (
        <div className={cn("frenz-glass-tile absolute inset-x-0 top-0 rounded-[26px]", variant === "hero" ? "h-[300px]" : "h-[172px]")} aria-label="Loading suggestions" role="status" />
      ) : null}
      {variant === "panel" && total > 0 ? <Dots pos={answered} total={total} /> : null}
    </div>
  );

  return (
    <section aria-labelledby={`deck-${variant}`} className={cn("frenz-nav-glass frenz-nav-glass--static relative isolate overflow-hidden text-frenz-ink", variant === "hero" ? "rounded-[34px] px-[18px] pb-5 pt-[18px]" : "rounded-[32px] px-4 pb-3.5 pt-4")}>
      {/* owner, 2026-10-31: the panel floats as the bottom nav's glass (not the purple gradient); the card on it is glass that
          barely lifts, since the panel already floats; every tap is the nav's spring press */}
      <div className={cn("relative flex items-center justify-between gap-3", variant === "hero" ? "mb-4" : "mb-3.5")}>
        <h2 id={`deck-${variant}`} className="font-heading text-[18px] font-bold tracking-[-0.3px]">
          {variant === "hero" ? "Suggestions" : "Suggested for you"}
        </h2>
        {variant === "hero" ? (
          total > 0 ? (
            <span className="frenz-glass-pill flex h-[30px] items-center rounded-[15px] px-3 text-[13px] font-bold tabular-nums text-frenz-violet">
              {Math.min(answered + 1, total)} of {total}
              {!exhausted ? "+" : ""}
            </span>
          ) : null
        ) : seeAllHref ? (
          <PendingLink href={seeAllHref} prefetch={false} onPointerDown={onWarmSeeAll} className="frenz-glass-pill flex h-11 items-center rounded-full px-3.5 text-[13px] font-bold text-frenz-violet" spinnerSize={15}>
            See all
          </PendingLink>
        ) : null}
      </div>
      {stack}
      {variant === "hero" && deck[0] && !done ? <HeroControls person={deck[0]} onAdd={() => answer(deck[0]!, "add")} onSkip={() => answer(deck[0]!, "skip")} /> : null}
      <FriendsToast toast={toast} onHide={hide} />
    </section>
  );
}

function Dots({ pos, total }: { pos: number; total: number }) {
  const n = Math.min(6, total);
  const active = Math.min(pos, n - 1);
  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-center gap-[5px]" role="img" aria-label={`${Math.min(pos + 1, total)} of ${total}`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cn("h-1.5 rounded-[3px] transition-[width] duration-200", i === active ? "w-[22px] bg-frenz-violet" : "w-1.5 bg-frenz-ink/20")} />
      ))}
    </div>
  );
}

function Face({ person, size, eager }: { person: PersonSuggestion; size: number; eager: boolean }) {
  const ring = size >= 100 ? "p-[3px]" : "p-[2.5px]";
  const border = size >= 100 ? "border-[3px]" : "border-[2.5px]";
  return (
    <span aria-hidden className={cn("flex shrink-0 rounded-full bg-frenz-gradient shadow-[0_14px_30px_-12px_rgb(91_63_240/0.6)]", ring)} style={{ width: size, height: size }}>
      {person.avatarUrl ? (
        <StableAvatar src={person.avatarUrl} width={size} height={size} loading={eager ? "eager" : "lazy"} className={cn("h-full w-full rounded-full border-white object-cover", border)} />
      ) : (
        <span className={cn("flex flex-1 items-center justify-center rounded-full border-white bg-frenz-gradient font-heading font-bold text-white", border)} style={{ fontSize: size * 0.35 }}>
          {person.displayName.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function Reason({ text, chip }: { text: string; chip: boolean }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 font-bold text-frenz-violet", chip ? "h-8 rounded-2xl bg-frenz-violet/10 pl-2.5 pr-3 text-[13px]" : "text-[12px]")}>
      <UserCheck className="h-[15px] w-[15px] shrink-0" strokeWidth={2.3} aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  );
}

function Card({
  person,
  variant,
  front,
  pressed,
  onAdd,
  onSkip,
}: {
  person: PersonSuggestion;
  variant: "panel" | "hero";
  front: boolean;
  pressed?: "add" | "skip";
  onAdd: () => void;
  onSkip: () => void;
}) {
  if (variant === "hero") {
    return (
      <div className="frenz-glass-tile flex h-[300px] flex-col items-center gap-1.5 rounded-[30px] px-[18px] pb-[18px] pt-[22px] text-center text-frenz-ink">
        <Face person={person} size={108} eager={front} />
        <span className="mt-2 flex max-w-full items-center gap-1">
          <span className="truncate font-heading text-[22px] font-bold tracking-[-0.5px]">{person.displayName}</span>
          {person.isVerified ? <VerifiedTick size="sm" className="h-4 w-4 shrink-0" /> : null}
        </span>
        <span className="text-[14px] text-frenz-muted">@{person.handle}</span>
        <span className="mt-1.5 max-w-full">
          <Reason text={person.reason} chip />
        </span>
      </div>
    );
  }
  return (
    <div className="frenz-glass-tile flex h-[172px] flex-col gap-3 rounded-[26px] p-3.5 text-frenz-ink">
      <PendingLink href={profilePath(person.handle)} prefetch={false} inner="flex min-w-0 items-center gap-3" className="block rounded-2xl" tabIndex={front ? 0 : -1}>
        <Face person={person} size={60} eager={front} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate font-heading text-[17px] font-bold tracking-[-0.3px]">{person.displayName}</span>
            {person.isVerified ? <VerifiedTick size="sm" className="h-[15px] w-[15px] shrink-0" /> : null}
          </span>
          <span className="truncate text-[13px] text-frenz-muted">@{person.handle}</span>
          <Reason text={person.reason} chip={false} />
        </span>
      </PendingLink>
      <div className="flex gap-2">
        <PendingButton
          onClick={onSkip}
          pending={pressed === "skip"}
          spinnerSize={16}
          aria-label={`Skip ${person.displayName}`}
          tabIndex={front ? 0 : -1}
          className="frenz-glass-pill flex h-[46px] w-12 shrink-0 items-center justify-center rounded-[23px] text-frenz-muted"
        >
          <X className="h-[17px] w-[17px]" strokeWidth={2.6} aria-hidden />
        </PendingButton>
        <PendingButton
          onClick={onAdd}
          pending={pressed === "add"}
          tabIndex={front ? 0 : -1}
          aria-label={`Add ${person.displayName} as a friend`}
          className="flex h-[46px] flex-1 items-center justify-center rounded-[23px] bg-frenz-gradient-x font-heading text-[15px] font-bold text-white shadow-[0_10px_22px_-10px_rgb(91_63_240/0.8)]"
          inner="inline-flex items-center justify-center gap-[7px]"
        >
          <UserPlus className="h-[17px] w-[17px]" strokeWidth={2.4} aria-hidden />
          Add friend
        </PendingButton>
      </div>
    </div>
  );
}

function HeroControls({ person, onAdd, onSkip }: { person: PersonSuggestion; onAdd: () => void; onSkip: () => void }) {
  return (
    <div className="relative flex items-center justify-center gap-[22px]">
      <PendingButton onClick={onSkip} aria-label={`Skip ${person.displayName}`} className="frenz-glass-pill flex h-[60px] w-[60px] items-center justify-center rounded-full text-frenz-ink">
        <X className="h-[22px] w-[22px]" strokeWidth={2.6} aria-hidden />
      </PendingButton>
      <PendingButton
        onClick={onAdd}
        aria-label={`Add ${person.displayName} as a friend`}
        className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-frenz-gradient-x text-white shadow-[0_12px_26px_-12px_rgb(91_63_240/0.6)]"
      >
        <UserPlus className="h-[30px] w-[30px]" strokeWidth={2.3} aria-hidden />
      </PendingButton>
      <PendingLink
        href={profilePath(person.handle)}
        prefetch={false}
        aria-label={`View ${person.displayName}'s profile`}
        className="frenz-glass-pill flex h-[60px] w-[60px] items-center justify-center rounded-full text-frenz-ink"
      >
        <UserRound className="h-[22px] w-[22px]" strokeWidth={2.2} aria-hidden />
      </PendingLink>
    </div>
  );
}
