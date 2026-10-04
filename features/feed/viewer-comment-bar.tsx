"use client";

import { Mic, Send, Smile, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE COMMENT BAR — edge to edge at the bottom, TikTok-style
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-04: "let the bottom be comment just like tiktok style,
 * horizontal from left edge to right, let the comment be premium and glass
 * style, and the placeholder should show the style, voice comment, and all the
 * buttons and premium glass icon in the placeholder."
 *
 * Before this, the only way to reach the conversation was the speech-bubble in
 * the right-hand rail — a glyph that auto-hides with the rest of the chrome. So
 * on a photo the member was looking at, the single most common action was
 * invisible half the time and never looked like a place you could type.
 *
 * ── 🔴 THE RESTING STATE IS THE POINT ──────────────────────────────────────
 *
 * "The placeholder should show … all the buttons": this bar is not a text field
 * that reveals its tools on focus. Every affordance — voice, stickers, send —
 * is on screen in the resting state, because a control nobody can see is a
 * control nobody uses. That is the same reasoning that took the "Save to
 * device" button OFF the wallpaper rail: visible, few, and real.
 *
 * ── 🔴 IT DOES NOT OWN THE COMPOSER, AND MUST NOT ──────────────────────────
 *
 * Tapping anything here opens the existing comments sheet. The real composer
 * lives in `features/social/comments.tsx` and already has the voice recorder,
 * the sticker picker, the image attachment, mentions and the moderation rules.
 * Re-implementing a second composer here would be a second set of those rules,
 * and the two would disagree within a month. This bar is a DOOR with a preview
 * of what is behind it, not a copy of the room.
 *
 * So every button is real — each one opens the surface that performs it — and
 * none of them pretends to do the work itself.
 *
 * ── Safe area ──────────────────────────────────────────────────────────────
 *
 * `env(safe-area-inset-bottom)` as PADDING, not margin: the glass must reach
 * the physical bottom edge of the screen (the owner asked for edge to edge),
 * while the controls inside it sit above the home indicator. A margin would
 * leave a black strip under the blur and break the "edge to edge" it is for.
 */
export function ViewerCommentBar({
  count,
  avatarUrl,
  onOpen,
  canComment = true,
  className,
}: {
  /** Shown beside the label so the bar says how busy the conversation is. */
  count: number;
  /** The VIEWER's avatar — "you are the one who would be typing". Null when signed out. */
  avatarUrl?: string | null;
  /** Opens the real composer. `intent` lets a button land on the right tool. */
  onOpen: (intent: "text" | "voice" | "sticker") => void;
  canComment?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Edge to edge, and above the rail's bottom offset.
        "absolute inset-x-0 bottom-0 z-40",
        // The glass itself: a dark, heavily blurred pane with a single hairline
        // on top. No rounded corners — a radius here would stop it reading as
        // part of the screen's edge.
        "border-t border-white/10 bg-black/35 backdrop-blur-2xl",
        "pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/*
          The premium glass mark. It is the viewer's own avatar when there is
          one — the strongest possible "this is you typing" — and the brand's
          glass sparkle when there is not, rather than a grey silhouette.
        */}
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a remote avatar URL; the optimizer adds a round trip for a 28px image
          <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/20" />
        ) : (
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-400/30 to-fuchsia-400/20 ring-1 ring-inset ring-white/25 backdrop-blur-md"
          >
            <Sparkles className="h-4 w-4 text-white/90" />
          </span>
        )}

        {/* The field. A BUTTON, not an input: it opens the real composer, and an
            input here would focus a box that cannot actually send. */}
        <button
          type="button"
          onClick={() => onOpen("text")}
          disabled={!canComment}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-left ring-1 ring-inset ring-white/15 backdrop-blur-md transition",
            canComment ? "hover:bg-white/15 active:scale-[0.99]" : "opacity-60",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-white/60">
            {canComment ? "Add a comment…" : "Comments are off"}
          </span>
          {count > 0 ? <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-white/45">{count.toLocaleString()}</span> : null}
        </button>

        {/* The tools, in the resting state. Each opens the composer on its own
            tool rather than doing the work here — see the note above. */}
        <BarButton label="Stickers" onClick={() => onOpen("sticker")} disabled={!canComment}>
          <Smile className="h-[18px] w-[18px]" aria-hidden />
        </BarButton>
        <BarButton label="Voice comment" onClick={() => onOpen("voice")} disabled={!canComment}>
          <Mic className="h-[18px] w-[18px]" aria-hidden />
        </BarButton>
        <BarButton label="Write a comment" onClick={() => onOpen("text")} disabled={!canComment} tone="primary">
          <Send className="h-[18px] w-[18px]" aria-hidden />
        </BarButton>
      </div>
    </div>
  );
}

function BarButton({
  children,
  label,
  onClick,
  disabled,
  tone = "glass",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "glass" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset backdrop-blur-md transition active:scale-90",
        tone === "primary"
          ? "bg-gradient-to-br from-violet-500/70 to-fuchsia-500/60 text-white ring-white/25"
          : "bg-white/10 text-white/85 ring-white/15 hover:bg-white/15",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {children}
    </button>
  );
}
