"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronRight,
  Clock,
  File as FileIcon,
  Ban,
  Download,
  Forward,
  Repeat2,
  Loader2,
  Lock,
  MapPin,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Reply as ReplyIcon,
  Send,
  SmilePlus,
  Star,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamicImport from "next/dynamic";

import { RichText } from "@/components/social/rich-text";
import { revalidate } from "@/features/data";
import { ContactPickerSheet } from "@/features/social/contact-picker-sheet";
import { DocumentAttachmentCard } from "@/features/social/document-attachment-card";
import { GiftBubble, type GiftMeta } from "@/features/gift/gift-bubble";
import { GiftComposerButton } from "@/features/gift/gift-composer-button";
import { EmojiPickerButton } from "@/features/social/emoji-picker-button";
import { ForwardSheet } from "@/features/social/forward-sheet";
import { cacheThread, getCachedThread, mergeMissing } from "@/features/social/thread-cache";
import { ReshareSheet } from "@/features/social/reshare-sheet";
import { saveMediaToDevice } from "@/lib/media/save-to-device";
import { INBOX_KEY, loadInbox } from "@/features/social/inbox";
import { MediaComposerSheet } from "@/features/social/media-composer-sheet";
import { extractSharedPost, MessagePostEmbed } from "@/features/social/message-post-embed";
import { PollBubble } from "@/features/social/poll-bubble";
import { PollComposerSheet } from "@/features/social/poll-composer-sheet";
import { StoryViewer } from "@/features/app-shell/dashboard/stories-row";
import { useThreadAppearance } from "@/features/social/thread-appearance-context";
import { useChatAppearance } from "@/features/social/use-chat-appearance";
import { useTypingIndicator } from "@/features/social/use-typing";
import { VoiceMessage, VideoComment } from "@/features/social/comment-media";
import { VoiceRecorder } from "@/features/social/voice-recorder";
import { ImageLightbox } from "@/features/social/image-lightbox";
import {
  enqueueMessage,
  listQueuedForConversation,
  replayMessageQueue,
  subscribeMessageFailure,
  subscribeMessageQueue,
} from "@/lib/offline/message-queue";
import { readImageDimensions, readVideoMetadata } from "@/lib/media/message-attachments-client";
import { captureVideoPoster } from "@/lib/media/video-poster";
import { haptic } from "@/lib/motion/haptics";
import { useLongPress } from "@/lib/dom/use-long-press";
import { springs } from "@/lib/motion/springs";
import { playSound } from "@/lib/notifications/sound-fx";
import { useNetworkStatus } from "@/lib/pwa/use-network-status";
import { BUBBLE_STYLE_SHAPE, type ChatAppearance, type ChatBubbleSkin, effectiveBubbleStyle, isBubbleSkin } from "@/lib/social/chat-appearance";
import { SkinDecorations, skinProps } from "@/features/social/bubble-skin";
import { FONT_STYLE_CLASS } from "@/lib/social/chat-fonts";
import { MESSAGE_REACTIONS } from "@/lib/social/message-meta";
import {
  attachmentKindForMime,
  extForFilename,
  formatBytes,
  isAllowedMime,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_SIZE_BYTES,
  type AttachmentKind,
} from "@/lib/social/message-media";
import type { AttachmentInput, ConversationMember, ConversationTheme, ConversationType, MemberRole, MessageAttachment, MessageItem } from "@/lib/social/messages";
import type { StoryGroup } from "@/lib/social/stories";
import { storyReplyText } from "@/lib/social/story-reply-text";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { useVisualViewport } from "@/lib/pwa/use-visual-viewport";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";

import { cn } from "@/lib/utils";
import { SwipeToReply } from "@/features/social/swipe-to-reply";
import { sameMessageGroup } from "@/lib/social/message-groups";
import { CameraIcon, MicIcon, SendIcon as SendGlyph } from "@/features/frenz-ui/icons";
import { toast } from "@/features/ui/toast";
import { profilePath } from "@/lib/social/profile-url";
import { requestTypingPush, roomTypingTopic, TYPING_REVOKED_EVENT, type TypingRevokedDetail } from "@/features/social/typing-privacy";
import { isOnlineNow } from "@/features/friends/use-presence";

/**
 * Layout effect on the client, plain effect during SSR (where layout effects
 * never run and React warns if you register one). The thread's scroll-to-bottom
 * MUST be a layout effect: a plain effect fires after paint, so every entry
 * showed the top of the thread for a frame before jumping to the newest message.
 */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const COMPOSER_MAX_HEIGHT = 128;
const DRAFT_PREFIX = "frenz-draft:";
// Voice hold-to-record gesture thresholds (owner mockup).
const MIC_HOLD_COMMIT_MS = 200;
/** How far before the last sync a catch-up asks from — see `resync`. */
const RESYNC_OVERLAP_MS = 30_000;
const MIC_CANCEL_PX = 80;
const MIC_LOCK_PX = 80;

/** Chat Themes (inbox mockup completion) — each drives BOTH an accent color
 *  (sent bubbles, send button) AND a matching background wash, per owner's
 *  explicit choice (the mockup itself only shows the color swatches). */
// 2026-10-19 (design/ChatMenu.dc.html, "brand colors only"): Blue, Violet and Magenta are the brand's own
// colours; Midnight and Mono are new (0264) and stay dark in both themes (the ink token turns light in dark
// mode). green and orange can no longer be picked but still render for a chat that already uses one.
const THEME_BUBBLE_CLASS: Record<ConversationTheme, string> = {
  blue: "bg-frenz-blue",
  pink: "bg-frenz-magenta",
  green: "bg-gradient-to-br from-emerald-500 to-green-600",
  orange: "bg-gradient-to-br from-orange-500 to-amber-600",
  purple: "bg-frenz-violet",
  midnight: "bg-[linear-gradient(135deg,hsl(250_60%_29%),hsl(250_48%_8%))]",
  mono: "bg-[hsl(247_21%_8%)] dark:bg-white/15",
};
// Owner ask (2026-07-14): "users can also set the whole message page theme"
// — a 5-6% tint read as barely-there, not like the theme actually applied to
// the page. Bumped to a genuinely visible wash while staying well clear of
// text-contrast issues (still a wash behind normal bubbles, not a solid fill).
const THEME_WASH_CLASS: Record<ConversationTheme, string> = {
  blue: "bg-frenz-blue/[0.12] dark:bg-frenz-blue/[0.14]",
  pink: "bg-frenz-magenta/[0.12] dark:bg-frenz-magenta/[0.14]",
  green: "bg-emerald-500/[0.12] dark:bg-emerald-400/[0.14]",
  orange: "bg-orange-500/[0.12] dark:bg-orange-400/[0.14]",
  purple: "bg-frenz-violet/[0.12] dark:bg-frenz-violet/[0.14]",
  midnight: "bg-frenz-violet/[0.08] dark:bg-frenz-violet/[0.12]",
  mono: "bg-black/[0.05] dark:bg-white/[0.05]",
};

function draftKey(conversationId: string): string {
  return `${DRAFT_PREFIX}${conversationId}`;
}

/**
 * Session-warm thread cache (owner ask, 2026-07-14: "posts shared in chat
 * shouldnt reload each time the chats is opened"). Root cause: this page is
 * `force-dynamic` and refetches the WHOLE conversation server-side on every
 * navigation into it — even reopening the same thread seconds later in the
 * same session — and this component seeds its state fresh from that `initial`
 * prop on every mount with no memory of what was already loaded. Mirrors
 * `message-post-embed.tsx`'s own module-level `Map` cache (same tab-lifetime,
 * no-TTL shape) one level up: instead of caching one shared-post preview per
 * id, this caches a whole thread's message list per conversation id, capped
 * to the last MRU `THREAD_CACHE_LIMIT` threads so a long session browsing
 * many chats doesn't grow this unbounded. `resync()` still runs on every
 * mount regardless (below) to quietly catch anything that changed while the
 * thread was cached but not open — this only removes the visible reload,
 * never the correctness of catching up.
 */
interface RawMessage {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  pinned: boolean;
  metadata: Record<string, unknown> | null;
}

function receiptLabel(m: MessageItem): { label: string; read: boolean; delivered: boolean; at: string } {
  if (m.readAt) return { label: "Seen", read: true, delivered: true, at: m.readAt };
  if (m.deliveredAt) return { label: "Delivered", read: false, delivered: true, at: m.deliveredAt };
  return { label: "Sent", read: false, delivered: false, at: m.createdAt };
}

/** "9:14 AM" — the mockup's under-bubble time label. */
/**
 * The soft dark gradient in the bottom-right corner of a frameless photo or
 * video, so the time and ticks read on any picture — WhatsApp's own device.
 */
/** The story-reply label's icon: a story ring with a reply arrow (2026-10-26 — in place of the ↩️ emoji). */
function StoryReplyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M12 3a9 9 0 1 1-8.2 5.3" strokeDasharray="3 2.6" />
      <path d="M15 9.5h-4.5a2.5 2.5 0 0 0 0 5H15" />
      <path d="M12.5 7l-2.5 2.5L12.5 12" />
    </svg>
  );
}

function MediaMetaScrim({ children }: { children: ReactNode }) {
  return (
    <span className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-black/55 to-transparent px-2.5 pb-1.5 pt-6">
      {children}
    </span>
  );
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "TODAY" / "YESTERDAY" / "JUL 4" — the mockup's centered date divider. */
function dayDividerLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}


/**
 * Realtime chat (direct + group): seeded server-side (instant), then live. New
 * messages arrive over a Supabase channel scoped to this conversation; sends
 * append optimistically. Delivery/read receipts (Sent → Delivered → Seen) —
 * direct threads only — update live via UPDATE events. Reply/edit/delete/pin
 * ride the SAME `messages` UPDATE/INSERT subscription (they're just more
 * columns on a row this channel already watches); reactions get their own
 * lightweight subscription that triggers the existing catch-up resync rather
 * than hand-rolling incremental patching from partial realtime payloads.
 */
// the send sheet loads only when Credits is tapped (2026-10-07)
const ChatSendCredits = dynamicImport(() => import("@/features/ai/wallet/chat-send-credits").then((m) => m.ChatSendCredits), { ssr: false });
// Frenz Gift Coin Part 4: the sticker gallery and gift confirmation, fetched only when opened
const GiftSheet = dynamicImport(() => import("@/features/gift/gift-sheet").then((m) => m.GiftSheet), { ssr: false });

export function ConversationRoom({
  conversationId,
  viewerId,
  viewerName,
  viewerHandle = null,
  initial,
  initialSyncedAt,
  type = "direct",
  members = [],
  viewerRole = null,
  onlyAdminsCanSend = false,
  otherName = null,
  otherId = null,
  viewerTypingIndicatorsEnabled = true,
  otherStoryGroup = null,
  initialAppearance,
  memberSkins = {},
}: {
  conversationId: string;
  viewerId: string;
  viewerName: string;
  viewerHandle?: string | null;
  initial: MessageItem[];
  initialSyncedAt: string;
  /** SSR-read personal appearance for THIS chat — seeds the first paint so the
   *  saved bubble style/color/font shows immediately, never a default-blue
   *  flash-then-switch on every entry (owner report 2026-07-16). */
  initialAppearance?: ChatAppearance;
  /** The other members' bubble skins for this chat, by user id — each paints that sender's own messages. */
  memberSkins?: Record<string, ChatBubbleSkin>;
  type?: ConversationType;
  members?: ConversationMember[];
  viewerRole?: MemberRole | null;
  onlyAdminsCanSend?: boolean;
  /** Direct threads: the other party's display name (drives the mockup's
   *  personalized "Message Maya…" composer placeholder). */
  otherName?: string | null;
  /** Direct threads: the other party's user id — the typing push asks only while they're off the app. */
  otherId?: string | null;
  /** Part 11b privacy toggle — the VIEWER's own "show when I'm typing" choice. Reciprocal since 2026-10-18: false means this thread neither sends nor shows typing (no typing channel is joined). */
  viewerTypingIndicatorsEnabled?: boolean;
  /** The other party's active stories (direct threads only) — the mockup's
   *  "Name · N stories" strip at the top of the thread. Null when they have
   *  none active, or this isn't a direct thread. */
  otherStoryGroup?: StoryGroup | null;
}) {
  // Reopening a thread visited earlier this session should paint instantly
  // from whatever was last rendered, not the server's fresh-every-nav
  // `initial` payload — see the `threadCache` doc comment above. Read once
  // per mount (this component remounts on every `/messages/[id]` navigation,
  // same or different id, since the route is force-dynamic).
  // The server's `initial` can be newer than the session copy (it is fetched on
  // this navigation), so rows only it has are merged in rather than ignored.
  const [cachedThread] = useState(() => {
    const c = getCachedThread(conversationId);
    return c ? { ...c, messages: mergeMissing(c.messages, initial) } : undefined;
  });
  const [messages, setMessages] = useState<MessageItem[]>(cachedThread?.messages ?? initial);
  // Theme/wallpaper now come from the shared ThreadAppearanceProvider (wraps
  // this component + ThreadHeader together) instead of this component's own
  // props + its own realtime subscription — see that file's doc comment for
  // why (the header never saw a live update, and the wallpaper never painted
  // anywhere near the header/composer, only this component's own message
  // list box).
  const { theme: liveTheme, wallpaperUrl: liveWallpaperUrl } = useThreadAppearance();
  // Personal appearance prefs for THIS conversation (owner ask 2026-07-16:
  // per-chat, not global) — font style applies to every bubble's text (both
  // mine + theirs, a legibility preference isn't sender-specific); bubble
  // style/color apply to MY OWN sent bubbles only, layered UNDER the
  // per-conversation Chat Theme (falls back to it when no personal color is
  // set) — see lib/social/chat-appearance.ts. Seeded from SSR (initialAppearance)
  // so the saved look paints on the first frame, no default-blue flash.
  const chatAppearance = useChatAppearance(conversationId, initialAppearance);
  // a saved Halloween skin paints as the default after October (lib/social/chat-appearance.ts)
  const myBubbleStyle = effectiveBubbleStyle(chatAppearance.bubbleStyle);
  const bubbleShape = BUBBLE_STYLE_SHAPE[myBubbleStyle];
  // the design's drawn bubbles (owner, 2026-10-23, design/frenzsave-bubble-styles.html). "Just like TikTok": each
  // sender's skin paints THEIR OWN messages, and everyone in the chat sees it — my skin on mine, theirs on theirs.
  const mySkin = isBubbleSkin(myBubbleStyle) ? myBubbleStyle : null;
  const skinOf = (mine: boolean, senderId: string): ChatBubbleSkin | null => (mine ? mySkin : (memberSkins[senderId] ?? null));
  // Neither a color theme nor a custom wallpaper is set — the WhatsApp-style
  // light default (owner ask, 2026-07-14: "make the message page background
  // color to be white like whatsapp"), regardless of the app's own dark
  // mode, since a chat surface intentionally keeping a fixed light look is
  // its own deliberate product choice here, not the app shell's theme.
  const useLightDefault = !liveTheme && !liveWallpaperUrl;

  // Real bug found 2026-07-14 (owner report: "friends stories still doesn't
  // show"): next.config.ts's `staleTimes.dynamic` is 6 HOURS — a deliberate,
  // separate choice for instant cross-navigation (see [[loading-architecture]])
  // — but it means a client-side nav (tapping a conversation row) into a
  // thread visited within the last 6h serves the Next.js CLIENT ROUTER
  // CACHE's stale RSC payload, not a fresh one, regardless of this page's own
  // `force-dynamic` (which only governs the SERVER's behavior on an actual
  // request — it does nothing for a cache hit that never reaches the
  // server). `otherStoryGroup` (unlike messages/theme/wallpaper, which are
  // independently kept live over realtime) is a plain prop with no live-
  // update path, so it stayed stuck at whatever was true up to 6h ago.
  // Tried `router.refresh()` first — technically fixed the staleness, but
  // empirically (real 2-account Playwright repro) it broke the typing
  // indicator's second burst: a full route refresh's reconciliation, even
  // without visibly remounting this component, disrupted the shared realtime
  // channel singleton in use-typing.ts somehow. Given the "always own this
  // channel" contract that hook depends on, a targeted client-side re-fetch
  // of JUST the story state is the safer fix — it never touches the route
  // or this component's own mount lifecycle at all.
  const [liveOtherStoryGroup, setLiveOtherStoryGroup] = useState(otherStoryGroup);
  // The header story ring's cover: an image story is its own cover, a video
  // story uses the poster stored at upload (0083). Null only for a pre-0083
  // video story, which falls back to <video> below.
  const storyRingCover =
    liveOtherStoryGroup?.stories[0]?.mediaKind === "image"
      ? liveOtherStoryGroup.stories[0].mediaUrl
      : (liveOtherStoryGroup?.stories[0]?.thumbnailUrl ?? null);
  useEffect(() => {
    setLiveOtherStoryGroup(otherStoryGroup);
    if (type !== "direct" || !otherName) return;
    let cancelled = false;
    fetch(`/api/conversations/${conversationId}/story`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && "storyGroup" in d) setLiveOtherStoryGroup(d.storyGroup);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- otherStoryGroup/otherName/type intentionally excluded: this refetches once per conversationId, re-seeding from the (possibly stale) prop first
  }, [conversationId]);

  const [body, setBody] = useState("");
  // Staged image/video/document attachments — uploaded the moment they're
  // picked (see the media composer sheet), previewed as chips above the
  // composer, then sent together with whatever caption text is present.
  // Voice notes bypass this entirely — VoiceRecorder's own preview/send UI
  // already covers that step, so a recorded note sends immediately instead
  // of becoming a staged chip (matches every real chat app's mic-button
  // behavior: record → release → sent, no separate caption step).
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentInput[]>([]);
  // 2026-10-07 (owner): send credits from the + sheet — a direct chat's other member
  const [sendCreditsOpen, setSendCreditsOpen] = useState(false);
  const closeSendCredits = useCallback(() => setSendCreditsOpen(false), []);
  const creditsRecipient = useMemo(() => {
    if (type !== "direct") return null;
    const m = members.find((x) => x.id !== viewerId);
    return m ? { userId: m.id, name: m.displayName || `@${m.handle}`, handle: m.handle, avatarUrl: m.avatarUrl } : null;
  }, [type, members, viewerId]);
  // Frenz Gift Coin Part 4: who a gift can go to — the other member of a direct chat, or a chosen member of a group.
  // Never in a secret chat (gift details are server-visible); the server re-checks every rule (send_gift).
  const [giftOpen, setGiftOpen] = useState(false);
  // Part 6: "Send one back" from the reveal opens the sheet straight on that sticker
  const [giftStickerId, setGiftStickerId] = useState<string | null>(null);
  const giftRecipients = useMemo(() => {
    if (type === "secret") return [];
    // 🔴 a DIRECT chat carries no member list (lib/social/messages.ts fills only `other`), so the gift button never
    // showed in a 1:1 chat (owner, 2026-10-28: "no even sticker button"). The other person comes from otherId there.
    if (type === "direct") return otherId ? [{ userId: otherId, name: otherName || "them", avatarUrl: members.find((x) => x.id === otherId)?.avatarUrl ?? null }] : [];
    return members.filter((x) => x.id !== viewerId).map((x) => ({ userId: x.id, name: x.displayName || `@${x.handle}`, avatarUrl: x.avatarUrl }));
  }, [type, members, viewerId, otherId, otherName]);
  const memberName = useCallback((id: string) => { const x = members.find((mm) => mm.id === id); return x ? x.displayName || `@${x.handle}` : "someone"; }, [members]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [mediaSheetOpen, setMediaSheetOpen] = useState(false);
  // Frenz Gift Coin: warm the gift sheet's code as soon as the attachment sheet opens (owner, 2026-10-27: open really fast)
  useEffect(() => {
    if (mediaSheetOpen && type !== "secret") void import("@/features/gift/gift-sheet");
  }, [mediaSheetOpen, type]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [storyViewerOpen, setStoryViewerOpen] = useState(false);
  // Voice hold-to-record gesture (owner mockup: press-and-hold the mic,
  // slide left to cancel or up to lock) — null means "no hold gesture in
  // progress," which is also the state for a plain tap (see mic button's
  // onClick below), so VoiceRecorder's tap-to-open behavior is unchanged.
  const [holdGesture, setHoldGesture] = useState<{ dragX: number; dragY: number; canceled: boolean; locked: boolean } | null>(null);
  const [autoStopAndSend, setAutoStopAndSend] = useState(false);
  const [viewingImage, setViewingImage] = useState<{ url: string; alt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // The "..." button's own position varies a lot with bubble width (it sits
  // right next to the bubble, not at a fixed screen edge) — anchoring the
  // menu with plain `left-0`/`right-0` relative to that narrow button let it
  // run off-screen on a real phone whenever a received message's bubble was
  // wide (confirmed: "Forward" clipped at a 390px viewport). Measuring the
  // button's rect and rendering the menu `fixed`, clamped to the viewport,
  // keeps it on-screen regardless of bubble width or which side it's on.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  // Chat @mention autocomplete — filters the already-loaded member roster
  // client-side (a group has at most MAX_GROUP_MEMBERS=50, no server round
  // trip needed, unlike comments.tsx's global-user search). Notifications
  // are driven server-side by parsing the FINAL sent body (see
  // lib/social/message-meta.ts's parseMentionedHandles) — this is purely a
  // typing aid, same division of responsibility as the comment composer.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState<number | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [forwardingId, setForwardingId] = useState<string | null>(null);
  /** The chat attachment currently being reshared out to feed/reel/story. */
  const [resharing, setResharing] = useState<{
    messageId: string;
    attachmentId: string;
    kind: "image" | "video";
    previewUrl: string | null;
  } | null>(null);
  /** Optimistic overrides for the sender's per-message reshare switch, keyed by
   *  message id. Layered OVER `m.allowReshare` so the menu flips on the tap
   *  rather than waiting for a resync to bring the new value back. */
  const [reshareAllowed, setReshareAllowed] = useState<Record<string, boolean>>({});

  const saveMedia = async (url: string, kind: "image" | "video", filename?: string | null) => {
    setOpenMenuId(null);
    haptic("selection");
    const result = await saveMediaToDevice({ url, kind, filename });
    // Report what ACTUALLY happened — a dismissed share sheet is not a save,
    // and claiming "Saved" when the file never landed is worse than silence.
    if (result === "saved") toast(kind === "video" ? "Video saved" : "Photo saved", "success");
    else if (result === "failed") toast("Couldn't save that.", "error");
    /* "shared" (handed to the OS sheet) and "cancelled" speak for themselves */
  };

  const toggleMessageReshare = async (messageId: string, next: boolean) => {
    setOpenMenuId(null);
    setReshareAllowed((prev) => ({ ...prev, [messageId]: next }));
    haptic("selection");
    try {
      const res = await fetch("/api/reshare", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "message", sourceId: messageId, allowReshare: next }),
      });
      if (!res.ok) throw new Error();
      toast(next ? "Others can reshare this" : "Resharing turned off for this", "success");
    } catch {
      // Roll back to whatever the server last told us.
      setReshareAllowed((prev) => {
        const copy = { ...prev };
        delete copy[messageId];
        return copy;
      });
      toast("Couldn't save that.", "error");
    }
  };
  // Owner (2026-07-12): the old Supabase-channel-status banner ("Connecting…"/
  // "Reconnecting…") fired on brief realtime hiccups that had nothing to do
  // with the user's actual network — a backend blip, not a real outage —
  // and read as unprofessional flapping. Now sourced from the REAL browser
  // online/offline signal instead: a persistent "You're offline" while
  // actually disconnected, and a brief "Back online" confirmation on the
  // real reconnect, never anything in between.
  const { online } = useNetworkStatus();
  const wasOffline = useRef(false);
  const [showBackOnline, setShowBackOnline] = useState(false);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setShowBackOnline(false);
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      setShowBackOnline(true);
      const t = setTimeout(() => setShowBackOnline(false), 2500);
      return () => clearTimeout(t);
    }
  }, [online]);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const micHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micHoldStartRef = useRef<{ x: number; y: number } | null>(null);
  const micHoldEngagedRef = useRef(false);
  const micPointerHandledRef = useRef(false);
  const seen = useRef(new Set((cachedThread?.messages ?? initial).map((m) => m.id)));
  const bubbleRefs = useRef(new Map<string, HTMLDivElement>());
  const messagesRef = useRef<MessageItem[]>(cachedThread?.messages ?? initial);
  const lastSyncedAt = useRef(cachedThread?.syncedAt ?? initialSyncedAt);
  useEffect(() => {
    messagesRef.current = messages;
    cacheThread(conversationId, { messages, syncedAt: lastSyncedAt.current });
  }, [messages, conversationId]);

  // Ghost Mode is reciprocal (owner, 2026-10-18): typing off ⇒ this thread joins NO typing
  // channel, so it neither sends nor shows typing. A block or messaging restriction made
  // from this thread drops the channel as soon as the server confirms it (typing-privacy.ts).
  const [typingRevoked, setTypingRevoked] = useState(false);
  useEffect(() => {
    setTypingRevoked(false);
    const onRevoked = (e: Event) => {
      if ((e as CustomEvent<TypingRevokedDetail>).detail?.conversationId === conversationId) setTypingRevoked(true);
    };
    window.addEventListener(TYPING_REVOKED_EVENT, onRevoked);
    return () => window.removeEventListener(TYPING_REVOKED_EVENT, onRevoked);
  }, [conversationId]);
  const { typingNames, notifyTyping, clearTyping } = useTypingIndicator(
    roomTypingTopic(conversationId, viewerTypingIndicatorsEnabled, typingRevoked),
    viewerId,
    viewerName,
    viewerTypingIndicatorsEnabled,
  );
  // Every composer keystroke: the live indicator, plus — at most once per 5 minutes, direct chats
  // only, only while the other person is OFF the app — a "… is typing" push (owner, 2026-10-18).
  // Presence is read at this moment (isOnlineNow), not subscribed, so the thread never re-renders for it.
  const onComposerTyping = useCallback(() => {
    notifyTyping();
    requestTypingPush(conversationId, {
      conversationType: type,
      typingEnabled: viewerTypingIndicatorsEnabled,
      revoked: typingRevoked,
      otherId,
      otherOnline: otherId ? isOnlineNow(otherId) : false,
    });
  }, [notifyTyping, conversationId, type, viewerTypingIndicatorsEnabled, typingRevoked, otherId]);
  // A single soft tick when someone STARTS typing — not per keystroke, and
  // not re-triggered while they keep typing or a second person joins in.
  const wasTypingRef = useRef(false);
  useEffect(() => {
    const isTyping = typingNames.length > 0;
    if (isTyping && !wasTypingRef.current) {
      playSound("typing");
      haptic("light");
    }
    wasTypingRef.current = isTyping;
  }, [typingNames.length]);

  // Draft persistence: restore on mount, save (debounced by the effect's own
  // batching) on every change, clear once actually sent.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey(conversationId));
      if (saved) setBody(saved);
    } catch {
      /* localStorage unavailable (private mode) — drafts just don't persist */
    }
    // Only ever run once per mounted thread — not on every `body` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);
  useEffect(() => {
    try {
      if (body.trim()) localStorage.setItem(draftKey(conversationId), body);
      else localStorage.removeItem(draftKey(conversationId));
    } catch {
      /* best-effort */
    }
  }, [conversationId, body]);

  // Offline queue: reflect queued/failed state onto the matching optimistic
  // bubble (id scheme: `optimistic-<clientId>`, see submit()), and replay
  // whatever's due whenever this thread mounts, comes back online, or the
  // tab regains focus.
  useEffect(() => {
    const refreshQueueState = () => {
      void listQueuedForConversation(conversationId).then((items) => {
        setQueuedIds((prev) => {
          const next = new Set(items.map((i) => i.clientId));
          if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
          return next;
        });
        // Re-seed a bubble for anything still queued that this mount's
        // `initial` snapshot doesn't know about — a message queued while
        // offline, then the app closed/reopened BEFORE it replayed, must
        // still show in the thread (as "Waiting to send…"), not silently
        // disappear until it eventually lands.
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          // Also skip anything whose content already landed under its REAL
          // id (a rare race: the send actually succeeded server-side but
          // the client never got the response, so the queue entry is
          // stale) — the imminent replayMessageQueue() call below will
          // clear that stale entry via the server's own duplicate check.
          const existingMineBodies = new Set(prev.filter((m) => m.mine).map((m) => m.body));
          const missing = items.filter((i) => !existingIds.has(`optimistic-${i.clientId}`) && !existingMineBodies.has(i.body));
          if (missing.length === 0) return prev;
          const seeded: MessageItem[] = missing.map((i) => ({
            id: `optimistic-${i.clientId}`,
            body: i.body,
            createdAt: i.clientSentAt,
            mine: true,
            senderId: viewerId,
            encryptionIv: null, // this app's regular (non-Secret-Chat) composer
            deliveredAt: null,
            readAt: null,
            replyTo: i.replyToPreview ?? null,
            editedAt: null,
            deletedAt: null,
            pinned: false,
            reactions: [],
            attachments: [], // the offline queue is text-only — see submit()'s own note
            metadata: null,
            // Optimistic/offline-queued bubbles are the viewer's OWN, and an author
            // can always reshare their own media — the switch only gates other people.
            allowReshare: true,
          }));
          for (const m of seeded) seen.current.add(m.id);
          return [...prev, ...seeded];
        });
      });
    };
    refreshQueueState();
    const unsubscribeQueue = subscribeMessageQueue(refreshQueueState);
    const unsubscribeFailure = subscribeMessageFailure((clientId) => {
      setFailedIds((prev) => new Set(prev).add(clientId));
    });
    void replayMessageQueue();
    const onOnline = () => void replayMessageQueue();
    window.addEventListener("online", onOnline);
    return () => {
      unsubscribeQueue();
      unsubscribeFailure();
      window.removeEventListener("online", onOnline);
    };
  }, [conversationId]);
  // Incoming messages from someone else feel "welcoming" (slide+fade in);
  // outgoing feels "satisfying" (a quick scale pop on send) — matching the
  // spec's own language for the two directions. Only messages that arrive
  // AFTER mount get a class here; the initial server-rendered batch never
  // does, so opening a thread with 50 messages doesn't cascade-animate all
  // of them at once. A CSS animation only replays when its element is freshly
  // mounted, so a persistent Set-membership check across re-renders is safe —
  // it won't re-trigger once the bubble is already in the DOM.
  const welcomedIds = useRef(new Set<string>());

  // Auto-growing composer — expands with content up to a cap, then scrolls
  // internally, instead of a fixed single-line input.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [body]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return members
      .filter((m) => m.id !== viewerId && (m.handle.toLowerCase().startsWith(q) || m.displayName.toLowerCase().startsWith(q)))
      .slice(0, 6);
  }, [mentionQuery, members, viewerId]);

  const checkMentionTrigger = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(?:^|\s)@([A-Za-z0-9_.]{0,30})$/.exec(before);
    if (m) {
      setMentionAnchor(caret - m[1]!.length - 1);
      setMentionQuery(m[1]!);
    } else {
      setMentionAnchor(null);
      setMentionQuery(null);
    }
  };

  const selectMention = (member: ConversationMember) => {
    if (mentionAnchor === null) return;
    haptic("light");
    const caret = textareaRef.current?.selectionStart ?? body.length;
    const insertAt = mentionAnchor;
    const next = `${body.slice(0, insertAt)}@${member.handle} ${body.slice(caret)}`;
    setBody(next);
    setMentionQuery(null);
    setMentionAnchor(null);
    requestAnimationFrame(() => {
      const pos = insertAt + member.handle.length + 2;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  };

  const append = useCallback(
    (m: MessageItem) => {
      setMessages((prev) => {
        if (seen.current.has(m.id)) return prev;
        // Every newly-arriving message animates in — INCLUDING your own
        // (owner 2026-07-16). This set used to be populated only for `!m.mine`,
        // so a message you sent just materialised with no motion at all while
        // messages you received rose in; the asymmetry is what made sending
        // feel cheap. The sound/haptic below stay gated on `!m.mine` — you
        // already got feedback from the send button itself, and double-ticking
        // your own send would be noise.
        welcomedIds.current.add(m.id);
        if (!m.mine) {
          // Same tick as the bottom nav (owner ask) — receiving a message
          // while actively in the thread should feel identical to sending
          // one, not a heavier/distinct alert tone.
          playSound("tap");
          haptic("light");
        }
        // My own realtime echo reconciles with the optimistic bubble I already
        // showed (same body, temp id) instead of appending a duplicate.
        if (m.mine) {
          const idx = prev.findIndex((x) => x.id.startsWith("optimistic-") && x.body === m.body);
          if (idx !== -1) {
            seen.current.add(m.id);
            // This is the SAME bubble continuing — it already played its send
            // animation as the optimistic one. Un-mark it: the swap changes the
            // React key (`optimistic-<clientId>` -> the real row id), which
            // remounts the node and would replay the CSS animation, so the
            // bubble would visibly animate a SECOND time the moment the server
            // echo landed. Only a genuinely new arrival should animate.
            welcomedIds.current.delete(m.id);
            const copy = prev.slice();
            // Keep the optimistic bubble's attachments when the echo has none.
            //
            // Owner report (2026-07-16): "the image and video sent in chat
            // disappears and turn to a small chat bubble … it waits for reloads
            // when I go out of chat and come back that's when it then shows."
            // This line was the cause. The `messages` INSERT event deliberately
            // carries `attachments: []` (the rows land in a SEPARATE insert, so
            // this payload can't know about them yet — see that handler's own
            // note), and replacing the optimistic bubble wholesale with it threw
            // away the photo/video that was already on screen, collapsing it to
            // an empty text bubble a few hundred ms after send.
            //
            // Preserving them is safe, not a guess: staged attachments are
            // UPLOADED at pick time, so `optimisticAttachments` already holds
            // the same final `mediaUrl`s the server will echo back — they're
            // permanent URLs, not local blobs, so there's nothing to reconcile.
            // An echo that DOES carry attachments still wins.
            copy[idx] = m.attachments.length === 0 && prev[idx]!.attachments.length > 0
              ? { ...m, attachments: prev[idx]!.attachments }
              : m;
            return copy;
          }
        }
        seen.current.add(m.id);
        return [...prev, m];
      });
    },
    [],
  );

  // Auto-scroll to the newest message — also re-runs when the on-screen
  // keyboard opens/closes (its height changes the thread's own scroll
  // height even though no new message arrived), so the latest bubble never
  // ends up hidden behind the keyboard the moment the composer is focused.
  const { height: viewportHeight, keyboardOpen } = useVisualViewport();
  // 🔴 2026-10-14 (owner: "too much gap between the placeholder and the keyboard"): iOS keeps
  // env(safe-area-inset-bottom) (~34px, the home-bar strip) while the keyboard is up, but the keyboard
  // already covers that strip, so the padding showed as an empty band above it. Drop it while typing.
  // 2026-10-15 (owner: "too much white space between the chat placeholder and the keyboard"): without the
  // keyboard the pad is the home-bar inset minus 8px (the bar itself sits ~8px off the bottom, as the nav pill's
  // gap rule in globals.css), not 12px ON TOP of the full inset — ~26px instead of ~46px on an iPhone.
  const composerBottomPad = keyboardOpen ? "pb-2" : "pb-[max(0.75rem,calc(env(safe-area-inset-bottom)-0.5rem))]";
  // useLayoutEffect, not useEffect (owner, 2026-07-16: "make the chat page open
  // from the botton on any entry so users dont need to scroll down to see new
  // messages"): a plain effect runs AFTER the browser paints, so every entry
  // showed the TOP of the thread for a frame and then jumped. A layout effect
  // runs before paint — the first frame the user ever sees is already at the
  // newest message. Guarded for SSR, where layout effects don't run and React
  // warns if you register one.
  useIsoLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    atBottomRef.current = true;
  }, [messages.length, viewportHeight]);

  /**
   * Whether the user was at the bottom BEFORE any late layout growth.
   *
   * Tracked on real scrolls rather than recomputed on demand, and that's the
   * whole point: growing content does NOT fire a scroll event, so this ref still
   * holds the user's actual intent at the moment media lands. Recomputing the
   * distance inside the handler instead (the first version of this) is subtly
   * broken — by then the content has ALREADY grown, so the viewer is suddenly
   * "500px from the bottom" and the re-pin declines to fire, which is exactly
   * the bug it exists to fix.
   */
  const atBottomRef = useRef(true);
  const handleThreadScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  /** Re-pin to the newest message, but only if the user hadn't scrolled away —
   *  yanking someone back down while they read history would be a worse bug. */
  const stickToBottomIfAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, []);

  /**
   * The belt to the reserved-dimensions braces (owner, 2026-07-17, with a
   * screenshot of a thread opening mid-conversation: "fix it for good please").
   *
   * Declared sizes stop most late growth, but not all of it — rows predating the
   * width/height columns, lazily-loaded video posters, font swaps. `load` does
   * NOT bubble, but it DOES propagate in the CAPTURE phase, so this single
   * listener on the scroller catches every <img>/<video> inside it however
   * deeply nested, with no per-element wiring and nothing to forget next time a
   * new attachment type is added.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("load", stickToBottomIfAtBottom, true);
    return () => el.removeEventListener("load", stickToBottomIfAtBottom, true);
  }, [stickToBottomIfAtBottom]);

  // Catch-up resync: `postgres_changes` has NO replay — messages sent while the
  // socket was suspended (backgrounded phone, tunnel, sleep) are lost from the
  // live stream. Refetch + MERGE (never replace — optimistic bubbles awaiting
  // their echo must survive) whenever the app resumes, comes back online, the
  // channel re-subscribes after a drop, or a reaction changed (see below).
  // Delta sync (`?since=`) — only what changed since the last successful
  // sync comes back, not the full last-300 window; `lastSyncedAt` only ever
  // advances on a CONFIRMED successful response, so a dropped connection
  // never silently skips a gap — the next successful call still asks for
  // everything since the last point we know we actually saw.
  //
  // 🔴 Overlap (owner, 2026-10-14: "a new message doesn't show when I enter the
  // chat, I have to go out and come back twice"). `syncedAt` is the APP
  // server's clock, while `updated_at` is stamped by Postgres `now()`, which is
  // the time its transaction STARTED. A message whose insert began a moment
  // before the read (or any skew between the two clocks) carries an
  // `updated_at` earlier than the `since` we send, so the delta skipped it, and
  // every later delta asked from an even later point: the message stayed
  // missing until a full load. The delta now asks from RESYNC_OVERLAP_MS
  // earlier. The merge below is keyed by id and ignores unchanged rows, so the
  // overlap costs a few repeated rows and never a repaint.
  //
  // A trigger that arrives while a resync is running (the subscribe landing,
  // the app resuming) is no longer dropped: it runs once more after it.
  const resyncing = useRef(false);
  const resyncAgain = useRef(false);
  const resync = useCallback(async () => {
    if (resyncing.current) {
      resyncAgain.current = true;
      return;
    }
    resyncing.current = true;
    try {
      const since = new Date(Date.parse(lastSyncedAt.current) - RESYNC_OVERLAP_MS).toISOString();
      const res = await fetch(`/api/messages/${conversationId}?since=${encodeURIComponent(since)}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { messages: MessageItem[]; syncedAt?: string };
      if (!d.messages) return;
      if (d.syncedAt) lastSyncedAt.current = d.syncedAt;
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        let changed = false;
        for (const m of d.messages) {
          const cur = byId.get(m.id);
          if (!cur) {
            seen.current.add(m.id);
            changed = true;
          } else if (
            cur.readAt !== m.readAt ||
            cur.deliveredAt !== m.deliveredAt ||
            cur.body !== m.body ||
            cur.editedAt !== m.editedAt ||
            cur.deletedAt !== m.deletedAt ||
            cur.pinned !== m.pinned ||
            // Attachments arriving is a REAL change. Without this clause the
            // second half of the "sent image turns into a small bubble" bug
            // stayed alive even once `append()` stopped wiping them: the
            // message_attachments INSERT fires this very resync, the delta
            // faithfully returns the row WITH its attachments — and then this
            // check, comparing only text/receipt/reaction fields, concluded
            // "nothing changed" and bailed out with `return prev`, throwing the
            // fetched attachments away. That's why the media only ever appeared
            // after leaving and re-entering the chat (a full, non-delta load).
            cur.attachments.length !== m.attachments.length ||
            cur.reactions.length !== m.reactions.length ||
            cur.reactions.some((r, i) => r.count !== m.reactions[i]?.count || r.mine !== m.reactions[i]?.mine)
          ) {
            changed = true;
          }
          // Never let a delta row blank out attachments we already have. The
          // delta path does load attachments for the rows it returns, so an
          // empty list here means "none", but an optimistic bubble mid-flight
          // (or a row fetched in the window before its attachment insert
          // committed) must not be downgraded to a text bubble by a merge.
          byId.set(m.id, m.attachments.length === 0 && cur && cur.attachments.length > 0 ? { ...m, attachments: cur.attachments } : m);
        }
        if (!changed) return prev;
        // Ghost cleanup: drop an optimistic bubble once its real echo has
        // landed (found in this delta) or it's old enough (20s) to be a
        // genuinely failed send. Everything else already in `byId` — all
        // prior history untouched by this delta batch — is kept as-is; with
        // delta sync, `d.messages` is only the small changed set, NOT the
        // full thread, so returning it alone (the pre-delta-sync shape of
        // this code) would silently wipe every older message from view on
        // every catch-up resync.
        // Body-text is the only signal available here (delta rows don't carry
        // the client id an optimistic bubble was created with) — but matching
        // "any landed row with this body" let ONE landed message consume
        // EVERY optimistic bubble with equal text, notably every attachment-
        // only send (body === "" for all of them): firing off two photos
        // back-to-back and having only the first land could silently vanish
        // the second, still in-flight one. Each landed body can now only
        // resolve ONE optimistic bubble.
        const landedBodyCounts = new Map<string, number>();
        for (const s of d.messages) {
          if (!s.mine) continue;
          landedBodyCounts.set(s.body, (landedBodyCounts.get(s.body) ?? 0) + 1);
        }
        for (const m of prev) {
          if (!m.id.startsWith("optimistic-")) continue;
          const remaining = landedBodyCounts.get(m.body) ?? 0;
          const landed = remaining > 0;
          if (landed) landedBodyCounts.set(m.body, remaining - 1);
          const stale = Date.now() - new Date(m.createdAt).getTime() >= 20_000;
          if (landed || stale) byId.delete(m.id);
        }
        return Array.from(byId.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      });
      void revalidate(INBOX_KEY, loadInbox, 0).catch(() => {});
    } catch {
      /* offline — the next resume/reconnect retries */
    } finally {
      resyncing.current = false;
      if (resyncAgain.current) {
        resyncAgain.current = false;
        void resyncRef.current();
      }
    }
  }, [conversationId]);
  const resyncRef = useRef(resync);
  resyncRef.current = resync;

  // Catch up the moment the thread opens, not only once the live channel has
  // subscribed: on a phone just back from the background the subscribe can be
  // slow or fail, and the thread painted from the session cache would sit there
  // without the message that brought the user in.
  useEffect(() => {
    void resync();
  }, [resync]);

  // Live: new messages (INSERT), receipt/edit/delete/pin changes (UPDATE),
  // and reactions (their own lightweight channel — a reaction changing is
  // rare enough per-thread that reusing the tested resync() path is simpler
  // and more correct than hand-rolling partial realtime payload patching).
  useEffect(() => {
    const supabase = createClient();
    let everSubscribed = false;
    let firstAttemptFailures = 0;
    let cancelled = false;
    let reactionDebounce: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const r = payload.new as RawMessage;
          const parent = r.reply_to_id ? messagesRef.current.find((x) => x.id === r.reply_to_id) : null;
          append({
            id: r.id,
            body: r.body,
            createdAt: r.created_at,
            mine: r.sender_id === viewerId,
            senderId: r.sender_id,
            // This component only ever renders direct/group threads — Secret
            // Chats (Part 11b) have their own room component and never reach
            // this realtime handler.
            encryptionIv: null,
            deliveredAt: r.delivered_at,
            readAt: r.read_at,
            replyTo: parent ? { id: parent.id, body: parent.body, senderId: parent.senderId, deleted: !!parent.deletedAt } : null,
            editedAt: r.edited_at,
            deletedAt: r.deleted_at,
            pinned: r.pinned,
            reactions: [],
            // Attachment rows land in a SEPARATE insert right after this one
            // (sendMessage() awaits both, but this INSERT event can still
            // arrive first) — the message_attachments subscription below
            // triggers a resync() shortly after to pick them up, same
            // pattern as reactions arriving on an existing message.
            attachments: [],
            metadata: r.metadata ?? null,
            // The realtime row doesn't carry it; a resync fills in the real
            // value moments later. `true` matches the column default, and the
            // server is the authority on every actual reshare anyway — this
            // only decides whether the menu row is offered for a beat.
            allowReshare: (r as RawMessage & { allow_reshare?: boolean | null }).allow_reshare ?? true,
          });
          void revalidate(INBOX_KEY, loadInbox, 0).catch(() => {});
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const r = payload.new as RawMessage;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === r.id
                ? {
                    ...m,
                    body: r.deleted_at ? "" : r.body,
                    deliveredAt: r.delivered_at,
                    readAt: r.read_at,
                    editedAt: r.edited_at,
                    deletedAt: r.deleted_at,
                    pinned: r.pinned,
                    // deleteMessage() clears message_reactions server-side —
                    // mirror that here too, otherwise a reaction pill added
                    // just before the delete landed stays visible/tappable
                    // on a bubble that's now just "This message was deleted".
                    reactions: r.deleted_at ? [] : m.reactions,
                    // A poll message is created in TWO writes — an insert
                    // (metadata: {kind:"poll"}, no id yet) then an update
                    // once the poll row exists (metadata: {kind:"poll",
                    // pollId}) — without merging metadata here, a recipient
                    // who already has the thread open keeps the INSERT's
                    // pollId-less payload forever, and PollBubble can never
                    // fetch/vote (root-caused, not guessed).
                    metadata: r.deleted_at ? null : (r.metadata ?? m.metadata),
                  }
                : m,
            ),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const messageId = (payload.new as { message_id?: string; user_id?: string }).message_id;
            const actorId = (payload.new as { user_id?: string }).user_id;
            // Only a genuinely new reaction from someone else, on MY OWN
            // message — not my own react, not an emoji switch (UPDATE), not
            // a reaction on someone else's message in this same thread.
            if (actorId !== viewerId && messagesRef.current.some((m) => m.id === messageId && m.mine)) {
              playSound("reaction");
            }
          }
          if (reactionDebounce) clearTimeout(reactionDebounce);
          reactionDebounce = setTimeout(() => void resync(), 400);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_attachments", filter: `conversation_id=eq.${conversationId}` },
        () => {
          // Attachment rows land in their own insert right after the parent
          // message's — same debounced-resync reconciliation as reactions,
          // rather than hand-patching a partial payload into state.
          if (reactionDebounce) clearTimeout(reactionDebounce);
          reactionDebounce = setTimeout(() => void resync(), 400);
        },
      )
      .subscribe(onSubscribeStatus);

    // Named (not inline) so the first-attempt retry below can pass it again —
    // `channel.subscribe()` called with NO callback silently drops every
    // future status delivery on this channel (verified against
    // @supabase/realtime-js: `callback?.(...)` everywhere), which would have
    // permanently killed reconnection/resync after the very first retry,
    // reproducing the exact "stuck" bug this was meant to fix.
    function onSubscribeStatus(status: string) {
      if (status === "SUBSCRIBED") {
        // Resync on EVERY subscribe, including the first — not just
        // reconnects. Real bug found 2026-07-14 (owner report: "have to go
        // back and come back for refresh"): a message sent in the window
        // between this component mounting (with the SSR-rendered initial
        // messages) and the channel actually finishing its first `subscribe`
        // — a real gap, confirmed empirically with two live test accounts —
        // was NEITHER part of the initial SSR payload NOR caught by the live
        // stream (which wasn't listening yet), and previously wasn't caught
        // by this resync either, since it only fired on RE-subscribes. Since
        // resync() is delta-based (`?since=` the SSR fetch's own timestamp),
        // calling it on the first subscribe too is cheap and closes the gap
        // completely rather than narrowing it.
        void resync();
        everSubscribed = true;
        firstAttemptFailures = 0;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (!everSubscribed) {
          // A first attempt that keeps failing (bad RLS grant, a transient
          // outage right at page load) used to sit silently in "connecting"
          // forever — Supabase doesn't auto-retry a channel past this point,
          // so nothing ever recovered it on its own. Retry the SAME channel
          // (re-registering .on() handlers would double them; only
          // .subscribe() itself is safe to call again) with a short backoff.
          // No banner fires from this anymore — see the real online/offline
          // tracking above — it just quietly keeps trying.
          firstAttemptFailures += 1;
          // Part 9 (2026-10-09): bounded. A channel the server keeps refusing (an RLS
          // denial) retried every 5 s forever, hidden or not. Six tries, never while
          // hidden; after that the visible/online resync below still refreshes the thread.
          if (!cancelled && firstAttemptFailures <= 6) {
            const delay = Math.min(1000 * firstAttemptFailures, 5000);
            window.setTimeout(() => {
              if (cancelled) return;
              if (document.visibilityState !== "visible") {
                firstAttemptFailures -= 1; // not an attempt: try again when the thread is looked at
                const retry = () => {
                  if (document.visibilityState !== "visible") return;
                  document.removeEventListener("visibilitychange", retry);
                  if (!cancelled) channel.subscribe(onSubscribeStatus);
                };
                document.addEventListener("visibilitychange", retry);
                return;
              }
              channel.subscribe(onSubscribeStatus);
            }, delay);
          }
        }
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void resync();
    };
    // Same bfcache gap as features/data/cache.ts's ensureGlobalRevalidation
    // — this component has its own bespoke message state instead of that
    // shared cache, so it needs its own `pageshow` listener. Without it, an
    // iOS back-gesture restoring a frozen thread (e.g. navigated away
    // mid-load, or just plain stale) never resyncs on its own.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      cancelled = true;
      if (reactionDebounce) clearTimeout(reactionDebounce);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      // removeChannel (not just channel.unsubscribe()) — the browser client
      // is now a shared singleton (lib/supabase/client.ts), so a channel left
      // registered here would sit on that ONE client for the rest of the tab's
      // life instead of being thrown away with a short-lived client instance.
      void supabase.removeChannel(channel);
    };
  }, [conversationId, viewerId, append, resync]);

  const cancelReplyOrEdit = () => {
    setReplyingTo(null);
    setEditingId(null);
    setBody("");
  };

  const startEdit = (m: MessageItem) => {
    setReplyingTo(null);
    setEditingId(m.id);
    setBody(m.body);
    setOpenMenuId(null);
  };

  const startReply = (m: MessageItem) => {
    setEditingId(null);
    setReplyingTo(m);
    setOpenMenuId(null);
  };

  const MENU_WIDTH = 160; // w-40
  const MENU_ITEM_HEIGHT = 40; // matches MenuItem's px-3.5 py-2 + text-sm line height
  // The rendered menu is a document.body PORTAL (see its createPortal call
  // below), not an inline sibling — on desktop this component lives inside
  // <main> (app/(app)/messages/layout.tsx), which carries lg:backdrop-blur-xl.
  // Per the CSS spec, backdrop-filter establishes a new containing block for
  // position:fixed descendants, so a `left`/`top` computed against
  // window.innerWidth/innerHeight (below) would render offset by <main>'s own
  // position instead of the true viewport — confirmed to push the menu ~600px
  // off-screen on a 1280px-wide desktop window. Portaling to <body> keeps this
  // math correct regardless of any blurred/transformed ancestor.
  // Takes the ANCHOR ELEMENT rather than an event (2026-07-16): the trigger is
  // now a press-and-hold on the bubble itself, not a click on a "⋯" button, and
  // a long-press has no single React event whose `currentTarget` survives to
  // fire time. Passing the element keeps the positioning maths below identical
  // while letting the hold, and desktop's right-click, share one path.
  const toggleMessageMenu = (id: string, anchor: HTMLElement) => {
    if (openMenuId === id) {
      setOpenMenuId(null);
      return;
    }
    // Only clamping the horizontal side (see the comment above menuPos) still
    // let the menu render off the BOTTOM of the viewport when tapped near
    // the bottom of the screen — the fixed `top-8`-equivalent offset never
    // accounted for how much room was actually left below the button. Reply/
    // Forward/React/Pin/Star are always present; Edit/Delete only for your
    // own, non-deleted, non-optimistic messages — same gating as the menu's
    // own render — so the estimate matches exactly what's about to be shown.
    const msg = messages.find((x) => x.id === id);
    const editDelete = msg && msg.mine && !msg.deletedAt && !id.startsWith("optimistic-") ? 2 : 0;
    const menuHeight = (5 + editDelete) * MENU_ITEM_HEIGHT + 12;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(rect.right - MENU_WIDTH, margin), window.innerWidth - MENU_WIDTH - margin);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= menuHeight + margin ? rect.bottom + 4 : Math.max(margin, rect.top - menuHeight - 4);
    setMenuPos({ top, left });
    setOpenMenuId(id);
  };

  // ONE hook for every bubble — `useLongPress` can't be called inside the
  // `messages.map()` below without breaking the rules of hooks, so the held
  // element carries its own message id (`data-message-id`) and this reads it
  // back at fire time. The bubble is also the anchor the menu positions
  // against, which is why the hook hands the element back.
  const holdBubble = useLongPress((anchor) => {
    const id = anchor.dataset.messageId;
    if (id) toggleMessageMenu(id, anchor);
  });

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // While the @mention dropdown is open, Enter picks the top match instead
    // of sending — matching the comment composer's own autocomplete
    // convention (a stray Enter shouldn't ship a half-typed @handle as text).
    if (e.key === "Enter" && !e.shiftKey && mentionMatches.length > 0) {
      e.preventDefault();
      selectMention(mentionMatches[0]!);
      return;
    }
    if (e.key === "Escape" && mentionQuery !== null) {
      setMentionQuery(null);
      setMentionAnchor(null);
      return;
    }
    /*
      🔴 ENTER STARTS A NEW LINE; THE SEND BUTTON SENDS (owner, 2026-10-22: "make the enter button not
      to send but to give paragraph below"). Enter is left to the textarea, so it inserts a line break
      like any text field. Ctrl/Cmd+Enter still sends from a desktop keyboard — a combination that
      never types a line break, so it cannot surprise anyone mid-paragraph.
    */
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const submit = async (e?: FormEvent, overrideAttachments?: AttachmentInput[]) => {
    e?.preventDefault();
    const text = body.trim();
    // Voice notes send immediately (VoiceRecorder's own preview already
    // covers the record→review→send step) rather than becoming a staged
    // chip — an explicit override lets that call site bypass the
    // `pendingAttachments` state entirely, since setState is async and
    // wouldn't be visible to a submit() called right after setting it.
    const attachments = overrideAttachments ?? pendingAttachments;
    if ((!text && attachments.length === 0) || busy) return;
    // Same tick as the bottom nav (owner ask) — sending a message should
    // feel like the same physical "tap" as everything else in the app.
    haptic("light");
    playSound("tap");
    setBusy(true);
    clearTyping();
    setMentionQuery(null);
    setMentionAnchor(null);

    if (editingId) {
      const id = editingId;
      const prevBody = messages.find((m) => m.id === id)?.body ?? "";
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body: text, editedAt: new Date().toISOString() } : m)));
      setEditingId(null);
      setBody("");
      try {
        const res = await fetch(`/api/messages/msg/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text }),
        });
        if (!res.ok) setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body: prevBody, editedAt: null } : m)));
      } catch {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body: prevBody, editedAt: null } : m)));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Optimistic: show it now; the realtime echo reconciles it (see `append`).
    // `clientId` doubles as the optimistic bubble id suffix AND the server's
    // idempotency key — queuedIds/failedIds (keyed by raw clientId) can spot
    // this exact bubble by stripping the `optimistic-` prefix off its id.
    const clientId = crypto.randomUUID();
    const optimisticId = `optimistic-${clientId}`;
    const clientSentAt = new Date().toISOString();
    const replyTo = replyingTo
      ? { id: replyingTo.id, body: replyingTo.body, senderId: replyingTo.senderId, deleted: !!replyingTo.deletedAt }
      : null;
    const optimisticAttachments: MessageAttachment[] = attachments.map((a, i) => ({
      id: `pending-${i}`,
      kind: a.mediaKind,
      url: a.mediaUrl,
      thumbnailUrl: a.thumbnailUrl ?? null,
      width: a.mediaWidth ?? null,
      height: a.mediaHeight ?? null,
      durationMs: a.durationMs ?? null,
      waveform: a.waveform ?? null,
      filename: a.filename ?? null,
      mimeType: a.mimeType ?? null,
      sizeBytes: a.sizeBytes ?? null,
    }));
    // THE bubble the owner's "animate luxurious… immediately after send" is
    // about: the optimistic one, painted the instant you hit send. It's added
    // here by a direct setMessages rather than through `append()`, so it never
    // entered `welcomedIds` and was the one message in the whole thread that
    // could never animate — the send felt inert no matter what the keyframes
    // did.
    welcomedIds.current.add(optimisticId);
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        body: text,
        createdAt: clientSentAt,
        mine: true,
        senderId: viewerId,
        encryptionIv: null,
        deliveredAt: null,
        readAt: null,
        replyTo,
        editedAt: null,
        deletedAt: null,
        pinned: false,
        reactions: [],
        attachments: optimisticAttachments,
        metadata: null,
        // Optimistic/offline-queued bubbles are the viewer's OWN, and an author
        // can always reshare their own media — the switch only gates other people.
        allowReshare: true,
      },
    ]);
    setBody("");
    setPendingAttachments([]);
    const replyToId = replyingTo?.id;
    setReplyingTo(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body: text, replyToId, clientId, clientSentAt, attachments: attachments.length ? attachments : undefined }),
      });
      if (res.ok) {
        // Bubble reconciles via the realtime echo (see `append`).
      } else if (res.status >= 500 && attachments.length === 0) {
        // Transient server-side failure — the offline queue backs off and
        // retries instead of just discarding the composer text. Text-only:
        // the queue (lib/offline/message-queue.ts) has no attachment
        // support (re-uploading a large blob from a background retry is a
        // materially different, bigger feature) — an attachment send that
        // fails falls through to the permanent-failure branch below instead
        // of silently vanishing into a queue that can't actually carry it.
        await enqueueMessage({ clientId, conversationId, body: text, replyToId, replyToPreview: replyTo ?? undefined, clientSentAt });
      } else {
        // Permanent (blocked/invalid), or transient-but-has-attachments —
        // remove the ghost bubble, give the text back, and log it so the
        // failure is visible in monitoring.
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setBody(text);
        if (attachments.length > 0) setPendingAttachments(attachments);
        void fetch("/api/messages/send-failures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, clientId, reason: `http_${res.status}`, attempts: 0 }),
        }).catch(() => {});
      }
    } catch {
      if (attachments.length === 0) {
        // Network dropped entirely mid-send — hand off to the offline queue
        // (delivers on reconnect, even much later); resync() also fires in
        // case the send actually landed despite the client-side exception.
        await enqueueMessage({ clientId, conversationId, body: text, replyToId, clientSentAt });
        void resync();
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setBody(text);
        setPendingAttachments(attachments);
      }
    } finally {
      setBusy(false);
    }
  };

  // Location/Contact shares (inbox mockup completion) — a small structured
  // payload, not text/a file, so this bypasses submit()'s body/attachment/
  // offline-queue machinery entirely rather than shoehorning a fake body
  // string through it. No offline-queue support (matching attachments) —
  // a location/contact share made offline just fails with a toast; retrying
  // a stale GPS fix later isn't meaningfully "the same" send anyway.
  const sendMetadataMessage = async (metadata: Record<string, unknown>) => {
    haptic("light");
    playSound("tap");
    const clientId = crypto.randomUUID();
    const optimisticId = `optimistic-${clientId}`;
    const clientSentAt = new Date().toISOString();
    // The other optimistic path (location / contact / poll sends) — animates
    // identically to a text send, so the thread never has two different
    // personalities depending on what you sent.
    welcomedIds.current.add(optimisticId);
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        body: "",
        createdAt: clientSentAt,
        mine: true,
        senderId: viewerId,
        encryptionIv: null,
        deliveredAt: null,
        readAt: null,
        replyTo: null,
        editedAt: null,
        deletedAt: null,
        pinned: false,
        reactions: [],
        attachments: [],
        metadata,
        // The viewer's own send — an author can always reshare their own media.
        allowReshare: true,
      },
    ]);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, clientId, clientSentAt, metadata }),
      });
      if (!res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        toast("Couldn't send that.", "error");
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      toast("Couldn't send that — check your connection.", "error");
    }
  };

  // Location share — real browser Geolocation, reverse-geocoded via OSM's
  // free Nominatim API for a human label (no paid map API key needed). A
  // failed/denied geolocation call or geocode just falls back to raw
  // coordinates rather than blocking the share entirely.
  const handleShareLocation = () => {
    if (!("geolocation" in navigator)) {
      toast("Location isn't available on this device.", "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        let label: string | null = null;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
            headers: { Accept: "application/json" },
          });
          if (res.ok) {
            const data = await res.json();
            label = (data?.display_name as string | undefined)?.split(",").slice(0, 2).join(",").trim() || null;
          }
        } catch {
          /* falls back to null label — the bubble shows "Shared location" instead */
        }
        void sendMetadataMessage({ kind: "location", lat, lng, label });
      },
      (err) => {
        // The three GeolocationPositionError codes mean genuinely different
        // things — a blanket "check permissions" message was actively
        // misleading for the other two (a real bug: a site-wide
        // Permissions-Policy header, not the user's own device/browser
        // settings, was actually the cause of PERMISSION_DENIED — see
        // next.config.ts's fix — but even once that's fixed, a real denial,
        // a signal timeout, and "no fix could be determined" are three
        // different problems with three different next steps).
        const message =
          err.code === err.PERMISSION_DENIED
            ? "Location access is blocked for this site — enable it in your browser or device settings."
            : err.code === err.TIMEOUT
              ? "Location took too long — check your signal and try again."
              : "Couldn't determine your location right now.";
        toast(message, "error");
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  };

  const handlePickContact = (person: { id: string; handle: string; displayName: string; avatarUrl: string | null }) => {
    setContactPickerOpen(false);
    void sendMetadataMessage({ kind: "contact", friendId: person.id, displayName: person.displayName, handle: person.handle, avatarUrl: person.avatarUrl });
  };

  // Voice hold-to-record gesture. A genuine hold only COMMITS after
  // MIC_HOLD_COMMIT_MS of continued pressure — a quick tap/click never
  // reaches this path at all, falling straight through to the mic button's
  // own onClick (unchanged, exactly today's tap-to-open behavior).
  //
  // The move/up listeners are registered ONCE for the component's whole
  // lifetime (empty-deps effect below) rather than dynamically added on
  // pointerdown and removed on pointerup — this component re-renders often
  // (new messages, typing state, etc.), and a dynamically-added listener
  // closes over THAT render's function identity; if a re-render happened
  // mid-gesture, a later `removeEventListener` call using a NEWER render's
  // function reference would silently fail to match what's actually
  // registered, leaking the listener. Registering once and gating all the
  // real logic on `micHoldStartRef`/`micHoldEngagedRef` (refs, so always
  // current regardless of which render's closure is asking) sidesteps the
  // whole reference-equality problem.
  const holdGestureRef = useRef(holdGesture);
  useEffect(() => {
    holdGestureRef.current = holdGesture;
  }, [holdGesture]);

  const endMicHold = (outcome: "tap" | "send" | "handled") => {
    if (micHoldTimerRef.current) {
      clearTimeout(micHoldTimerRef.current);
      micHoldTimerRef.current = null;
    }
    if (outcome === "send") setAutoStopAndSend(true);
    if (outcome !== "tap") {
      micPointerHandledRef.current = true;
      // The synthetic `click` that follows this same pointer interaction
      // fires on the next tick — clear the guard right after so a LATER,
      // genuine keyboard (Enter/Space) activation isn't silently swallowed.
      setTimeout(() => {
        micPointerHandledRef.current = false;
      }, 0);
    }
    micHoldEngagedRef.current = false;
    micHoldStartRef.current = null;
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const start = micHoldStartRef.current;
      if (!start || !micHoldEngagedRef.current) return;
      const dragX = e.clientX - start.x;
      const dragY = e.clientY - start.y;
      const canceled = dragX < -MIC_CANCEL_PX;
      const locked = -dragY > MIC_LOCK_PX;
      setHoldGesture((prev) => {
        if (prev?.canceled || prev?.locked) return prev;
        return { dragX, dragY, canceled, locked };
      });
      // End the GESTURE TRACKING (refs) the instant a threshold is crossed —
      // not just on the eventual pointerup. Without this, the finger stays
      // down for a moment after VoiceRecorder's own effect already reacted
      // to `canceled`/`locked` (unmounting on cancel, or continuing hands-
      // free on lock) — real bug found in review: the LATER pointerup then
      // read a stale, already-null `holdGesture` and misread it as "released
      // clean," setting `autoStopAndSend = true` with nothing mounted to
      // consume it — which then fired on the very NEXT plain tap, sending a
      // blank/instant voice note the user never intended.
      if ((canceled || locked) && micHoldEngagedRef.current) endMicHold("handled");
    };
    const onUp = () => {
      if (!micHoldStartRef.current) return; // no gesture in progress — ignore
      if (!micHoldEngagedRef.current) {
        // The commit timer never fired — a plain tap/click. Let the mic
        // button's own onClick handle it exactly as before this feature
        // existed; don't set holdGesture at all.
        endMicHold("tap");
        return;
      }
      const current = holdGestureRef.current;
      if (current?.canceled || current?.locked) endMicHold("handled");
      else endMicHold("send"); // released clean — auto-send the short clip
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (micHoldTimerRef.current) clearTimeout(micHoldTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMicPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    micHoldStartRef.current = { x: e.clientX, y: e.clientY };
    micHoldEngagedRef.current = false;
    micHoldTimerRef.current = setTimeout(() => {
      micHoldEngagedRef.current = true;
      setRecordingVoice(true);
      setAutoStopAndSend(false);
      setHoldGesture({ dragX: 0, dragY: 0, canceled: false, locked: false });
      haptic("selection");
    }, MIC_HOLD_COMMIT_MS);
  };

  // Uploads happen the moment a file is picked (not deferred to Send) — the
  // SAME presign+PUT pipeline post/reel media already uses (lib/storage/
  // client-upload.ts), so this never touches raw bytes server-side either.
  // Client-side re-validated against the same MAX_SIZE_BYTES/ALLOWED_MIME
  // the API route re-checks — never trust the file picker alone, but also
  // fail fast/cheap before spending a real upload on something that would
  // just get rejected server-side anyway.
  const handleFilesPicked = async (files: File[], kind: "image" | "video" | "document" | "audio") => {
    const room = MAX_ATTACHMENTS_PER_MESSAGE - pendingAttachments.length;
    if (room <= 0) {
      toast(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message.`, "error");
      return;
    }
    const list = files.slice(0, room);
    setUploadingCount((c) => c + list.length);
    for (const file of list) {
      try {
        const resolvedKind: AttachmentKind = attachmentKindForMime(file.type) ?? kind;
        if (file.size > MAX_SIZE_BYTES[resolvedKind]) {
          toast(`${file.name} is over the ${formatBytes(MAX_SIZE_BYTES[resolvedKind])} limit for ${resolvedKind}s.`, "error");
          continue;
        }
        if (!isAllowedMime(resolvedKind, file.type)) {
          toast(`${file.name} isn't a supported file type.`, "error");
          continue;
        }
        const ext = extForFilename(file.name);
        const url = await uploadPostMedia({ data: file, kind: resolvedKind, ext, contentType: file.type });
        let mediaWidth: number | undefined;
        let mediaHeight: number | undefined;
        let durationMs: number | undefined;
        let thumbnailUrl: string | undefined;
        if (resolvedKind === "image") {
          const dims = await readImageDimensions(file);
          if (dims) {
            mediaWidth = dims.width;
            mediaHeight = dims.height;
          }
        } else if (resolvedKind === "video") {
          const meta = await readVideoMetadata(file);
          if (meta) {
            mediaWidth = meta.width;
            mediaHeight = meta.height;
            durationMs = meta.durationMs;
          }
          // Capture + upload the first frame as a real cover (owner,
          // 2026-07-16: "videos sent in chat should always [have] a cover image
          // of the starting of the video").
          //
          // Chat video sends read metadata but NEVER captured a poster, so
          // `thumbnailUrl` was always null and every video bubble fell back to
          // a bare <video> — a black rectangle until the browser decoded a
          // frame. The create composer has always done this (see
          // composer-core's publishComposition); chat simply never did.
          //
          // Best-effort on purpose: a failed capture must not fail the SEND.
          // The bubble's `#t=0.1` fallback still paints the first frame in that
          // case, so the worst outcome is a slower cover, never a broken one.
          const captured = await captureVideoPoster(file).catch(() => ({ blob: null, width: null, height: null }));
          if (captured.blob) {
            thumbnailUrl =
              (await uploadPostMedia({ data: captured.blob, kind: "image", ext: "jpg", contentType: "image/jpeg" }).catch(
                () => undefined,
              )) ?? undefined;
          }
        }
        setPendingAttachments((prev) => [
          ...prev,
          {
            mediaKind: resolvedKind,
            mediaUrl: url,
            thumbnailUrl,
            mediaWidth,
            mediaHeight,
            durationMs,
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          },
        ]);
      } catch {
        toast(`Couldn't upload ${file.name}. Try again.`, "error");
      } finally {
        setUploadingCount((c) => Math.max(0, c - 1));
      }
    }
  };

  const removePendingAttachment = (index: number) => {
    haptic("light");
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Voice notes send immediately — see the state comment above.
  const handleVoiceRecorded = async (result: { url: string; durationMs: number; waveform: number[] }) => {
    setRecordingVoice(false);
    setHoldGesture(null);
    setAutoStopAndSend(false);
    await submit(undefined, [{ mediaKind: "audio", mediaUrl: result.url, durationMs: result.durationMs, waveform: result.waveform, mimeType: "audio/webm" }]);
  };

  // Part 10 — save to the viewer's private Starred list (distinct from
  // `pinned`, which is shared with the whole conversation). Deliberately no
  // client-side "is this starred" state/indicator on the bubble itself — the
  // Starred Messages view (reachable from the search sheet) is the one place
  // to see and manage what's starred, same scoping trade every other
  // fire-and-forget action-menu item here makes.
  const starMsg = async (id: string) => {
    setOpenMenuId(null);
    try {
      const res = await fetch(`/api/messages/msg/${id}/star`, { method: "POST" });
      toast(res.ok ? "Message starred." : "Couldn't star message.", res.ok ? "success" : "error");
    } catch {
      toast("Network error — try again.", "error");
    }
  };

  const deleteMsg = async (id: string) => {
    setOpenMenuId(null);
    const prev = messages;
    setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, body: "", deletedAt: new Date().toISOString(), pinned: false, reactions: [] } : m)));
    try {
      const res = await fetch(`/api/messages/msg/${id}`, { method: "DELETE" });
      if (!res.ok) setMessages(prev);
    } catch {
      setMessages(prev);
    }
  };

  const togglePin = async (m: MessageItem) => {
    setOpenMenuId(null);
    const next = !m.pinned;
    setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, pinned: next } : x)));
    try {
      const res = await fetch(`/api/messages/msg/${m.id}/pin`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, pinned: !next } : x)));
    } catch {
      setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, pinned: !next } : x)));
    }
  };

  const react = async (messageId: string, emoji: string) => {
    setReactingId(null);
    setOpenMenuId(null);
    setMessages((cur) =>
      cur.map((m) => {
        if (m.id !== messageId) return m;
        const withoutMine = m.reactions.map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r)).filter((r) => r.count > 0);
        const existing = withoutMine.find((r) => r.emoji === emoji);
        const reactions = existing
          ? withoutMine.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r))
          : [...withoutMine, { emoji, count: 1, mine: true }];
        return { ...m, reactions };
      }),
    );
    try {
      await fetch(`/api/messages/msg/${messageId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
    } catch {
      /* the reaction-channel resync reconciles on the next tick */
    } finally {
      void resync();
    }
  };

  // Show a receipt only under my most recent message (iMessage/IG style) — direct threads only.
  const lastMineId = useMemo(() => {
    if (type !== "direct") return null;
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.mine) return messages[i]!.id;
    return null;
  }, [messages, type]);

  const pinnedMessages = useMemo(() => messages.filter((m) => m.pinned && !m.deletedAt), [messages]);
  // Group owner/admin toggle (owner ask, 2026-07-12) — a plain "member" sees
  // a locked composer instead of the normal one; owner/admin are unaffected
  // regardless of the setting (they're always allowed to send).
  const sendLocked = type === "group" && onlyAdminsCanSend && viewerRole === "member";

  const scrollToMessage = (id: string) => {
    bubbleRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Deep-link from the Part 10 search sheet (`/messages/<id>?highlight=<messageId>`)
  // — scroll to + briefly flash the target bubble once it's actually mounted.
  // Known, accepted limit: only works if the message is within the initial
  // ~300-message load window `getConversation()` already fetches; jumping to
  // a much older starred/searched message would need real "load older
  // messages around this point" pagination, a real follow-up, not silently
  // faked here.
  const searchParams = useSearchParams();
  const highlightTarget = searchParams.get("highlight");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightTarget) return;
    if (!messages.some((m) => m.id === highlightTarget)) return;
    const raf = requestAnimationFrame(() => scrollToMessage(highlightTarget));
    setHighlightedId(highlightTarget);
    const clear = setTimeout(() => setHighlightedId(null), 2200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the target or the message list changes, not on every scrollToMessage identity change
  }, [highlightTarget, messages]);

  const senderName = (id: string): string => memberById.get(id)?.displayName ?? "Someone";

  return (
    <>
      {!online ? (
        <div className="flex items-center justify-center gap-1.5 bg-amber-500/15 px-4 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          <WifiOff className="h-3.5 w-3.5" />
          You&apos;re offline
        </div>
      ) : showBackOnline ? (
        <div className="flex items-center justify-center gap-1.5 bg-emerald-500/15 px-4 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <Wifi className="h-3.5 w-3.5" />
          Back online
        </div>
      ) : null}

      {pinnedMessages.length > 0 ? (
        <button
          type="button"
          onClick={() => scrollToMessage(pinnedMessages[0]!.id)}
          className="glass flex items-center gap-2 border-x-0 border-t-0 px-4 py-2 text-left text-xs font-medium text-muted-foreground transition hover:bg-secondary/60"
        >
          <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">
            {pinnedMessages[0]!.deletedAt ? "Pinned message" : pinnedMessages[0]!.body || "Pinned message"}
          </span>
          {pinnedMessages.length > 1 ? <span className="ml-auto shrink-0">+{pinnedMessages.length - 1} more</span> : null}
        </button>
      ) : null}

      {/* overflow-x-hidden is a defensive backstop, not the primary fix — the
          primary fix is MessagePostEmbed's card no longer asserting a fixed
          width wider than its bubble; this just guarantees a stray media/
          embed width can never force the whole thread to scroll sideways. */}
      <div
        ref={scrollRef}
        onScroll={() => {
          // Records whether the viewer is at the newest message, so late-loading
          // media can re-pin without fighting someone reading history.
          handleThreadScroll();
          // The action menu is now `fixed` (see toggleMessageMenu) so it can
          // clamp itself to the viewport — but that means it no longer
          // scrolls with its message, so it must close instead of visually
          // drifting away from the bubble it belongs to.
          if (openMenuId) setOpenMenuId(null);
        }}
        // media lock (globals.css): no iOS lift on a held photo or video — the ⋯ button opens its menu
        data-media-lock
        className={cn(
          "frenz-thread-scroll flex-1 space-y-1 overflow-x-hidden overflow-y-auto overscroll-y-none px-3 py-3",
          // Owner ask, 2026-07-14: "i want it to save and full screen, top 0
          // bottom 0 just like chat theme" — the wallpaper image itself now
          // paints on ThreadAppearanceProvider's shared outer container (see
          // that file), spanning the header + this list + the composer in
          // one continuous photo instead of being cropped to just this box.
          // This box stays transparent so it shows through.
          // the design's soft lilac ground behind the bubbles (white bubbles read on it without an outline)
          liveWallpaperUrl ? "bg-transparent" : useLightDefault ? "bg-frenz-chat" : liveTheme ? THEME_WASH_CLASS[liveTheme] : undefined,
        )}
      >
        {liveOtherStoryGroup ? (
          <button
            type="button"
            onClick={() => setStoryViewerOpen(true)}
            className="glass mb-2 flex w-full items-center gap-2.5 rounded-2xl p-2.5 text-left transition hover:bg-secondary/40"
          >
            <span className="rounded-full bg-brand p-0.5">
              <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-background p-0.5">
                {/* An <img> for both kinds — a video story uses its stored poster
                    (0083). This used to stream the MP4 through a <video> to paint
                    a 44px circle, and a <video> re-requests on every mount no
                    matter what: the SW deliberately skips video (native range
                    pipeline) and Safari re-fetches ranges regardless of
                    Cache-Control. Only an <img> can come from cache. */}
                {storyRingCover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={storyRingCover} alt="" className="h-full w-full rounded-full object-cover" />
                ) : liveOtherStoryGroup.stories[0]?.mediaKind === "video" ? (
                  // Legacy: a video story from before 0083 with no poster.
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video src={`${liveOtherStoryGroup.stories[0].mediaUrl}#t=0.3`} muted playsInline preload="metadata" className="h-full w-full rounded-full object-cover" />
                ) : liveOtherStoryGroup.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={liveOtherStoryGroup.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white">
                    {liveOtherStoryGroup.displayName.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold">
              {liveOtherStoryGroup.displayName} · {liveOtherStoryGroup.stories.length} {liveOtherStoryGroup.stories.length === 1 ? "story" : "stories"}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ) : null}
        {/* The viewer portals itself to <body> and has no emoji row — only the reply box. */}
        {storyViewerOpen && liveOtherStoryGroup ? (
          <StoryViewer groups={[liveOtherStoryGroup]} startGroup={0} onClose={() => setStoryViewerOpen(false)} />
        ) : null}
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
            <span className="bg-brand brand-glow flex h-14 w-14 items-center justify-center rounded-full">
              <Send className="h-5 w-5 -translate-x-0.5 text-white" />
            </span>
            <p className={cn("text-sm font-semibold", (useLightDefault || liveWallpaperUrl) && "text-neutral-900")}>Say hello</p>
            <p className={cn("max-w-[220px] text-xs text-muted-foreground", (useLightDefault || liveWallpaperUrl) && "!text-neutral-500")}>
              {type === "group" ? "Send the first message to get this group talking." : "Send the first message to start the conversation."}
            </p>
          </div>
        ) : (
          messages.map((m, i) => {
            const prevMsg = i > 0 ? messages[i - 1]! : null;
            const nextMsg = i < messages.length - 1 ? messages[i + 1]! : null;
            const showDayDivider = !prevMsg || !sameDay(prevMsg.createdAt, m.createdAt);
            const firstInGroup = !prevMsg || !sameMessageGroup(prevMsg, m);
            const lastInGroup = !nextMsg || !sameMessageGroup(m, nextMsg);
            const showReceipt = m.mine && m.id === lastMineId && !m.id.startsWith("optimistic-");
            const r = showReceipt ? receiptLabel(m) : null;
            const clientIdOfBubble = m.id.startsWith("optimistic-") ? m.id.slice("optimistic-".length) : null;
            const isQueued = clientIdOfBubble ? queuedIds.has(clientIdOfBubble) : false;
            const isFailed = clientIdOfBubble ? failedIds.has(clientIdOfBubble) : false;
            const deleted = !!m.deletedAt;
            // A shared post link renders as a rich preview card (creator,
            // cover, caption) with any note above it — never a raw URL.
            const shared = !deleted ? extractSharedPost(m.body) : null;
            // Image/video attachments go edge-to-edge in the bubble.
            const hasMediaAttachment = m.attachments.some((a) => a.kind === "image" || a.kind === "video");
            /*
              ── 🔴 THE BUBBLE IS WHATSAPP'S (owner, 2026-09-13) ──────────────

              "The media sent and received shouldn't have a border and it
              should be as clean and smooth, blending with any background
              wallpaper. And the chat shouldn't be in a vertical line no matter
              how short the word or sentence is — chats should always be in
              flex horizontal just like WhatsApp, and animate when sent."

              Two facts about the old bubble:
                · the time / ticks were a SEPARATE ROW under every bubble, so
                  "Ok" became two stacked lines — the vertical line;
                · a photo or video sat inside a 4px "hairline frame" with the
                  bubble's background, ring and shadow around it — the border.

              Now the meta lives INSIDE the bubble, floated to the end of the
              last line of text (it drops under the text only when the line is
              full — exactly WhatsApp's behaviour), a media-only bubble is
              frameless with the meta on a soft scrim over the media, and every
              other kind (voice, document, poll, a shared post) carries the meta
              as a right-aligned row at its foot. The one thing still UNDER a
              bubble is a problem — "Failed to send" / "Waiting to send…".

              The send animation is unchanged: an optimistic bubble already
              carries `animate-message-send` + `animate-scale-in` (see
              welcomedIds), and this layout keeps it.
            */
            const frameless =
              !deleted &&
              hasMediaAttachment &&
              !m.body &&
              !shared &&
              m.attachments.every((a) => a.kind === "image" || a.kind === "video");
            /*
              ONE TIME PER GROUP (owner brief, 2026-10-18: "group consecutive messages, one timestamp per
              group"). This replaces the per-bubble time (2026-09-13): the time — and on your newest
              message the receipt — sits under the LAST bubble of a group, as the design draws it. "edited"
              stays on the bubble it belongs to.
            */
            const groupMeta = deleted || !lastInGroup ? null : (
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap px-1 text-[11px] font-semibold leading-none text-frenz-muted"
                suppressHydrationWarning
              >
                <span>{timeLabel(m.createdAt)}</span>
                {m.mine && r ? <span>· {r.label}</span> : null}
                {m.mine && r ? (
                  // Owner receipt spec (2026-07-16): one grey tick = sent, two
                  // blue = delivered, two green = seen. Only the colour changes.
                  <span
                    className={cn("inline-flex", r.read ? "text-emerald-600" : r.delivered ? "text-frenz-blue" : "text-frenz-muted")}
                  >
                    {r.delivered ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                  </span>
                ) : null}
              </span>
            );
            // Inside a bubble only "edited" remains (the group's time is under it).
            const bubbleMeta = !deleted && m.editedAt ? (
              <span className={cn("text-[10px] font-medium leading-none", frameless ? "text-white" : skinOf(m.mine, m.senderId) && !deleted && !m.metadata?.kind ? "text-current opacity-70" : m.mine ? "text-white/75" : "text-neutral-500")}>edited</span>
            ) : null;
            /* Floated to the end of the last line — the WhatsApp trick. */
            const inlineMeta = bubbleMeta ? <span className="float-right ml-2 mt-1.5 -mb-0.5 pl-1">{bubbleMeta}</span> : null;
            /* A right-aligned foot row, for bubbles whose content is not text. */
            const footMeta = bubbleMeta ? <span className="mt-1 flex justify-end px-2.5 pb-1">{bubbleMeta}</span> : null;
            // ANY attachment gets the hairline frame (owner, 2026-07-16: "make
            // the bubble in chat that covers media and voice note and others to
            // be a tiny line not a fat line"). Voice notes and documents used to
            // keep the full `px-4 py-2.5` text padding, which drew a thick slab
            // of bubble around what is already a self-contained card — that's
            // the "fat line". They're now framed like media: just enough to read
            // as a bubble, nothing more.
            const hasAttachmentFrame = !deleted && m.attachments.length > 0;
            // owner, 2026-10-23 ("just like TikTok"): the SENDER's skin — mine on my messages, theirs on theirs, seen by
            // both; only plain text bubbles wear it, media, shared posts and placeholders keep their frame
            const senderSkin = skinOf(m.mine, m.senderId);
            const skinned = senderSkin && !deleted && !frameless && !shared && !hasAttachmentFrame && !m.metadata?.kind ? senderSkin : null;
            const locationMeta = !deleted && m.metadata?.kind === "location" ? (m.metadata as { lat: number; lng: number; label: string | null }) : null;
            const contactMeta =
              !deleted && m.metadata?.kind === "contact"
                ? (m.metadata as { friendId: string; displayName: string; handle: string; avatarUrl: string | null })
                : null;
            const pollMeta = !deleted && m.metadata?.kind === "poll" ? (m.metadata as { pollId: string }) : null;
            const giftMeta = !deleted && m.metadata?.kind === "gift" ? (m.metadata as GiftMeta) : null;
            // WhatsApp-style "X turned on/off disappearing messages" notice
            // (owner ask, 2026-07-14) — a real message row like any other
            // metadata kind, but rendered as a centered plain-text pill with
            // no bubble/avatar/mine-vs-theirs distinction, matching the
            // day-divider's own treatment rather than a normal chat bubble.
            const systemMeta = !deleted && m.metadata?.kind === "system" ? (m.metadata as { text: string }) : null;
            const canEdit = m.mine && !deleted && !m.id.startsWith("optimistic-");
            const canDelete = m.mine && !deleted && !m.id.startsWith("optimistic-");
            const canAct = !deleted && !m.id.startsWith("optimistic-");

            if (systemMeta) {
              return (
                <div key={m.id} className="flex flex-col items-center">
                  {showDayDivider ? (
                    <div
                      className={cn(
                        "mx-auto my-3 w-fit rounded-full bg-frenz-fill px-3 py-1 text-center text-xs font-bold text-frenz-ink/80",
                        liveWallpaperUrl && "!text-neutral-500",
                      )}
                    >
                      {dayDividerLabel(m.createdAt)}
                    </div>
                  ) : null}
                  <div
                    className={cn(
                      "mx-auto max-w-[85%] rounded-full bg-secondary/60 px-3.5 py-1.5 text-center text-[11px] font-medium text-muted-foreground",
                      (useLightDefault || liveWallpaperUrl) && "bg-neutral-100 !text-neutral-500",
                    )}
                  >
                    {systemMeta.text}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={m.id}
                ref={(el) => {
                  if (el) bubbleRefs.current.set(m.id, el);
                  else bubbleRefs.current.delete(m.id);
                }}
                className={cn(
                  // `w-full` is load-bearing, not cosmetic: it's what makes the
                  // row's `max-w-[80%]` below resolve against a DEFINITE width
                  // (see the vertical-text bug note there). Relying on the
                  // parent's default `align-items: stretch` would leave that
                  // silently dependent on a container this file doesn't own.
                  "group flex w-full flex-col",
                  m.mine ? "items-end" : "items-start",
                  firstInGroup && !showDayDivider && "pt-2",
                  // Scales out of its OWN corner — yours from the send button's
                  // side, theirs from the opposite one (see the keyframes in
                  // globals.css). Was a plain `animate-fade-up` for received
                  // messages only.
                  welcomedIds.current.has(m.id) && (m.mine ? "animate-message-send" : "animate-message-recv"),
                )}
              >
                {showDayDivider ? (
                  // The mockup's centered "TODAY" divider between day groups.
                  <div
                    className={cn(
                      "mx-auto my-3 w-fit rounded-full bg-frenz-fill px-3 py-1 text-center text-xs font-bold text-frenz-ink/80",
                      (useLightDefault || liveWallpaperUrl) && "!text-neutral-500",
                    )}
                  >
                    {dayDividerLabel(m.createdAt)}
                  </div>
                ) : null}
                {type === "group" && !m.mine ? (
                  <span className="mb-0.5 px-1 text-[11px] font-semibold text-muted-foreground">{senderName(m.senderId)}</span>
                ) : null}
                {/* The 80% cap lives HERE, on the row — not on the bubble.
                    Real bug (owner, 2026-07-16): "the bubble text showed
                    instantly in a vertical line the moment it was typed, when
                    the message isn't delivered yet." The bubble used to carry
                    `max-w-[80%]` itself, but its containing block is this row,
                    which is shrink-to-fit (the column above is `items-end`/
                    `items-start`). So the bubble's max-width resolved against a
                    width that itself depended on the bubble — a circular
                    constraint the browser settles by collapsing toward
                    min-content, i.e. ONE CHARACTER PER LINE. Messages that
                    already had a wide receipt line ("Delivered 9:14 AM ✓✓")
                    were propped open by that sibling and looked fine, which is
                    exactly why this only ever showed on a just-typed,
                    not-yet-delivered bubble — the optimistic one has no receipt
                    yet. This row is a flex item of the full-width message
                    column, so 80% here resolves against a DEFINITE width and
                    the bubble simply fills it (`max-w-full`). `min-w-0` keeps
                    long unbroken URLs wrapping instead of forcing an overflow. */}
                {/* swipe right to reply (owner, 2026-10-22) — the row itself, so the 80% cap below still resolves against the column */}
                <SwipeToReply
                  onReply={() => startReply(m)}
                  disabled={!canAct || deleted}
                  className={cn("flex max-w-[80%] items-end gap-1", m.mine ? "flex-row-reverse" : "flex-row")}
                >
                  {canAct && hasMediaAttachment ? (
                    <button
                      type="button"
                      aria-label="Message options"
                      onClick={(e) => {
                        const bubble = e.currentTarget.parentElement?.querySelector<HTMLElement>("[data-message-id]");
                        toggleMessageMenu(m.id, bubble ?? e.currentTarget);
                      }}
                      className="order-last mb-1 inline-flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full bg-black/25 text-white backdrop-blur-sm"
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                  <div
                    // Press-and-hold target (owner, 2026-07-16). `data-message-id`
                    // is how the single shared hook above knows WHICH bubble was
                    // held. Handlers only attach when there are actions to show,
                    // so a deleted/optimistic bubble stays inert rather than
                    // opening an empty menu.
                    data-message-id={m.id}
                    {...(skinned ? { "data-skin": skinned } : {})}
                    // a media bubble has no hold (owner 2026-10-12): its menu is the ⋯ button beside it
                    {...(canAct && !hasMediaAttachment ? holdBubble : {})}
                    style={m.mine && !deleted && !skinned && chatAppearance.bubbleColor ? { backgroundImage: "none", backgroundColor: chatAppearance.bubbleColor } : undefined}
                    className={cn(
                      // No pre-wrap here (owner 2026-10-19): in Safari it sized the bubble a hair narrower
                      // than its text, so "Afa na" broke one word per line. RichText keeps typed line breaks.
                      "frenz-message-bubble min-w-0 max-w-full overflow-hidden break-words leading-relaxed",
                      // A hold must open OUR menu, not iOS's text-selection
                      // callout — the two race otherwise and the system one
                      // wins. Copy stays available from the menu itself.
                      canAct && "select-none [-webkit-touch-callout:none]",
                      bubbleShape.base,
                      FONT_STYLE_CLASS[chatAppearance.fontStyle],
                      // a skin draws its own background, outline and colour; its decorations ride on the first
                      // bubble of a run, with room above for the ones that sit on top
                      skinned && skinProps(skinned).className,
                      skinned && firstInGroup && "mt-7",
                      // "Speech tail" bubble style: a real protruding pointer
                      // (see the .chat-bubble-tail-* rules in globals.css),
                      // not a corner-radius pinch — needs `relative` to anchor
                      // the pseudo-element, and never on a deleted placeholder
                      // (dashed/transparent — a solid pointer would look wrong).
                      bubbleShape.protrudingTail && !deleted && lastInGroup && "relative overflow-visible",
                      bubbleShape.protrudingTail && !deleted && lastInGroup && (m.mine ? "chat-bubble-tail-mine" : "chat-bubble-tail-theirs"),
                      // `p-1` (4px), not the old `p-1.5` (6px): a hairline frame
                      // around media/voice/documents rather than a fat band.
                      deleted ? "px-3.5 py-2.5 italic text-muted-foreground" : frameless ? "p-0" : shared || hasAttachmentFrame ? "p-1" : "px-3.5 py-2.5",
                      deleted
                        ? "border border-dashed border-border/60 bg-transparent"
                        : frameless
                          ? // No background, no ring, no shadow: the media IS the
                            // bubble, and it blends with whatever wallpaper is
                            // behind it. The media element carries its own radius.
                            "bg-transparent shadow-none"
                          : skinned
                          ? null
                          : m.mine
                          ? cn(
                              // A personal bubble-color preference (set via the
                              // `style` prop above, `background-color`) beats
                              // the conversation theme's gradient class here —
                              // `bg-brand`/THEME_BUBBLE_CLASS still apply as the
                              // CSS class (so nothing regresses when no personal
                              // color is set), but an inline `background-color`
                              // always wins over a class in CSS specificity.
                              // 🔴 the design's gradient bubble (design/Chat.dc.html; owner 2026-10-22: "replace … with the chat
                              // bubble design") — this REPLACES 2026-10-18's flat blue. A theme or a personal colour still wins.
                              liveTheme ? THEME_BUBBLE_CLASS[liveTheme] : "bg-frenz-bubble",
                              // the speech-tail pointer continues the gradient's end colour, not a little gradient of its own
                              !liveTheme && !chatAppearance.bubbleColor && "chat-bubble-gradient",
                              lastInGroup && bubbleShape.tailMine,
                              "text-white",
                            )
                          : // `.dark .glass` is a near-invisible white-on-white
                            // tint meant for a DARK backdrop — against the
                            // forced-light default/wallpaper background it
                            // read as an almost-blank bubble with white-on-
                            // white text. Explicit always-light colors here
                            // instead, matching WhatsApp's own received-bubble
                            // look, regardless of the app's own dark mode.
                            cn(
                              lastInGroup && bubbleShape.tailTheirs,
                              useLightDefault || liveWallpaperUrl
                                ? // the design's received bubble: white, a soft shadow, no outline
                                  "bg-white text-neutral-900 shadow-sm"
                                : "glass text-foreground shadow-sm",
                            ),
                      m.mine && m.id.startsWith("optimistic-") && "animate-scale-in",
                      m.id === highlightedId && "ring-2 ring-offset-2 ring-offset-background ring-amber-400 transition-shadow duration-500",
                    )}
                  >
                    {deleted ? (
                      "This message was deleted"
                    ) : (
                      <>
                        {m.replyTo ? (
                          <button
                            type="button"
                            onClick={() => scrollToMessage(m.replyTo!.id)}
                            className={cn(
                              "mb-1 block w-full truncate rounded-xl px-2.5 py-1 text-left text-[11px]",
                              skinned ? "bg-black/[0.06] text-current opacity-80" : m.mine ? "bg-white/15 text-white/85" : "bg-secondary text-muted-foreground",
                              shared && "mx-1.5 mt-1.5",
                            )}
                          >
                            {m.replyTo.deleted ? "Deleted message" : m.replyTo.body || "Message"}
                          </button>
                        ) : null}
                        {locationMeta ? (
                          <a
                            href={`https://www.openstreetmap.org/?mlat=${locationMeta.lat}&mlon=${locationMeta.lng}#map=16/${locationMeta.lat}/${locationMeta.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                              "flex items-center gap-2.5 rounded-2xl border px-3 py-2.5",
                              m.mine ? "border-white/20 bg-white/10" : "border-border/50 bg-secondary/30",
                            )}
                          >
                            <MapPin className="h-6 w-6 shrink-0 opacity-80" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold">{locationMeta.label || "Shared location"}</span>
                              <span className="block text-[11px] opacity-70">View on map</span>
                            </span>
                          </a>
                        ) : contactMeta ? (
                          <Link
                            href={`${profilePath(contactMeta.handle)}`}
                            className={cn(
                              "flex items-center gap-2.5 rounded-2xl border px-3 py-2.5",
                              m.mine ? "border-white/20 bg-white/10" : "border-border/50 bg-secondary/30",
                            )}
                          >
                            {contactMeta.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={contactMeta.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                            ) : (
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white">
                                {contactMeta.displayName.charAt(0).toUpperCase()}
                              </span>
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold">{contactMeta.displayName}</span>
                              <span className="block text-[11px] opacity-70">@{contactMeta.handle} · View contact</span>
                            </span>
                          </Link>
                        ) : pollMeta ? (
                          <PollBubble pollId={pollMeta.pollId} mine={m.mine} />
                        ) : giftMeta ? (
                          <GiftBubble
                            meta={giftMeta}
                            mine={m.mine}
                            viewerIsRecipient={giftMeta.recipientId === viewerId}
                            senderName={memberName(m.senderId)}
                            recipientName={memberName(giftMeta.recipientId ?? "")}
                            onSayThanks={() => requestAnimationFrame(() => textareaRef.current?.focus())}
                            onSendBack={giftRecipients.length > 0 && !sendLocked ? (stickerId) => { setGiftStickerId(stickerId); setGiftOpen(true); } : undefined}
                          />
                        ) : null}
                        {m.attachments.length > 0 ? (
                          <div className={cn("flex flex-col gap-1.5", hasMediaAttachment ? "" : "px-0", m.body && "mb-1.5")}>
                            {m.attachments.map((att, attIdx) =>
                              att.kind === "image" ? (
                                <span key={att.id} className="relative block overflow-hidden rounded-2xl">
                                <button
                                  type="button"
                                  onClick={() => setViewingImage({ url: att.url, alt: att.filename ?? "Image" })}
                                  className="block w-full overflow-hidden rounded-2xl"
                                >
                                  {/* width/height are LOAD-BEARING, not metadata:
                                      without them the browser reserves ZERO
                                      height for the image until it decodes, then
                                      snaps to full height — shoving every bubble
                                      below it down. That layout shift is the
                                      "scroll bug ... in some chat" (owner,
                                      2026-07-16): only chats WITH media have it.
                                      It's also why the thread didn't stay at the
                                      bottom — the mount scroll ran, THEN the
                                      image grew and pushed the newest message off
                                      screen. With the intrinsic size the browser
                                      computes the box before the bytes arrive and
                                      nothing moves.
                                      The values were already stored and already
                                      sent to the client (media_width/media_height,
                                      migration 0045); this <img> just never used
                                      them. */}
                                  {/*
                                    🔴 SHOWN AT THE BUBBLE'S SIZE, AT ONCE (owner, 2026-10-23: "when opening a chat with
                                    media, the media doesn't show at landing — it should show the thumbnail immediately").
                                    The bubble drew the ORIGINAL file — a phone photo is several MB — so nothing painted
                                    until all of it arrived. Now the optimiser serves a bubble-sized, compressed copy
                                    (cached at the edge after the first view), eagerly; the stored thumbnail, when there
                                    is one, sits under it from the first frame. Tapping still opens the original.
                                  */}
                                  {att.width && att.height ? (
                                    <Image
                                      src={att.url}
                                      alt=""
                                      width={att.width}
                                      height={att.height}
                                      sizes="(max-width: 640px) 80vw, 360px"
                                      quality={70}
                                      loading="eager"
                                      style={att.thumbnailUrl ? { backgroundImage: `url("${att.thumbnailUrl}")`, backgroundSize: "cover" } : undefined}
                                      className="max-h-80 w-full max-w-full bg-muted object-cover"
                                    />
                                  ) : (
                                    // eslint-disable-next-line @next/next/no-img-element -- no stored size: the plain element keeps its old behaviour
                                    <img src={att.url} alt="" decoding="async" className="max-h-80 w-full max-w-full object-cover" />
                                  )}
                                </button>
                                {frameless && attIdx === m.attachments.length - 1 ? <MediaMetaScrim>{bubbleMeta}</MediaMetaScrim> : null}
                                </span>
                              ) : att.kind === "video" ? (
                                <span key={att.id} className="relative block overflow-hidden rounded-2xl">
                                  <VideoComment url={att.url} thumbnailUrl={att.thumbnailUrl} durationMs={att.durationMs} width={att.width} height={att.height} />
                                  {frameless && attIdx === m.attachments.length - 1 ? <MediaMetaScrim>{bubbleMeta}</MediaMetaScrim> : null}
                                </span>
                              ) : att.kind === "audio" ? (
                                // Frameless (owner, 2026-10-08: "make record card frameless like the
                                // media card"): no inner bordered card — the player sits on the
                                // bubble itself, one surface, in the bubble's own theme colour.
                                <VoiceMessage key={att.id} url={att.url} durationMs={att.durationMs} waveform={att.waveform} surface="bg-transparent !px-2 !pb-0.5 !pt-1" onColor={m.mine} />
                              ) : (
                                <DocumentAttachmentCard key={att.id} url={att.url} filename={att.filename} sizeBytes={att.sizeBytes} mine={m.mine} />
                              ),
                            )}
                          </div>
                        ) : null}
                        {shared ? (
                          <>
                            {shared.text ? <span className="block px-2.5 pb-1.5 pt-1">{shared.text}</span> : null}
                            <MessagePostEmbed postId={shared.postId} mine={m.mine} />
                            {footMeta}
                          </>
                        ) : m.body ? (
                          // A caption sitting under an attachment needs its own
                          // inset now that the bubble itself is only a hairline
                          // frame — without this the text would sit 4px off the
                          // bubble edge. The meta floats at the end of the last
                          // line, inside this same box (see `inlineMeta`).
                          <span className={cn("block", hasAttachmentFrame && "px-2.5 pb-1 pt-0.5")}>
                            {/* a story reply: the label with its icon, then only the reply (2026-10-26 — no emoji prefix) */}
                            {storyReplyText(m.body, m.metadata) !== null ? (
                              <span className={cn("mb-0.5 flex items-center gap-1.5 text-[12px] font-semibold", m.mine && !skinned ? "text-white/80" : "text-frenz-violet")}>
                                <StoryReplyIcon />
                                {m.mine ? "You replied to their story" : "Replied to your story"}
                              </span>
                            ) : null}
                            <RichText
                              text={storyReplyText(m.body, m.metadata) ?? m.body}
                              linkClassName={cn("font-semibold underline underline-offset-2", skinned ? "text-current" : m.mine ? "text-white" : "text-primary")}
                            />
                            {inlineMeta}
                          </span>
                        ) : frameless ? null : (
                          // Voice, document, location, contact, poll — no words
                          // to float beside, so the meta is a foot row.
                          footMeta
                        )}
                        {skinned && firstInGroup ? <SkinDecorations skin={skinned} /> : null}
                      </>
                    )}
                  </div>

                  {canAct ? (
                    // The "⋯" button that used to live here is GONE (owner,
                    // 2026-07-16): message actions now open on a PRESS-AND-HOLD
                    // of the bubble itself (see `hold` above — plus right-click
                    // on desktop, which the same hook handles). A permanent
                    // glyph welded to every single bubble was the main thing
                    // keeping the thread from reading as premium.
                    <div className="relative shrink-0">
                      {openMenuId === m.id && menuPos
                        ? createPortal(
                            <>
                              <button
                                type="button"
                                aria-label="Close menu"
                                // onPointerDown, not onClick (2026-07-15, owner:
                                // the backdrop wasn't reliably closing this menu
                                // on tap): a plain `click` on touch only fires
                                // after touch-end, once the browser's own tap-vs-
                                // scroll disambiguation resolves — over a
                                // scrollable message list that resolution can
                                // swallow the synthetic click entirely, leaving
                                // the menu open. `pointerdown` fires immediately
                                // on first contact, before any scroll-gesture
                                // arbitration, so the backdrop reliably wins.
                                onPointerDown={() => setOpenMenuId(null)}
                                // 🔴 z-[60], not z-40 (owner, 2026-10-14: "users should be able to close
                                // this chat option by tapping on the chat background"). This is portaled
                                // to <body>, and on a phone the thread itself is `fixed z-50` (messages/
                                // [id]/page.tsx), so a z-40 backdrop sat UNDER the whole thread and a tap
                                // on the chat never reached it. Above the thread, under the toasts (z-100).
                                className="fixed inset-0 z-[60] cursor-default"
                              />
                              <div
                                style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
                                className="glass-strong animate-scale-in fixed z-[61] overflow-hidden rounded-2xl py-1"
                              >
                                <MenuItem icon={ReplyIcon} label="Reply" onClick={() => startReply(m)} />
                                <MenuItem
                                  icon={Forward}
                                  label="Forward"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setForwardingId(m.id);
                                  }}
                                />
                                <MenuItem
                                  icon={SmilePlus}
                                  label="React"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setReactingId(m.id);
                                  }}
                                />
                                <MenuItem
                                  icon={m.pinned ? PinOff : Pin}
                                  label={m.pinned ? "Unpin" : "Pin"}
                                  onClick={() => togglePin(m)}
                                />
                                <MenuItem icon={Star} label="Star" onClick={() => starMsg(m.id)} />
                                {/* Reshare media OUT of this chat — to the feed,
                                    Reels or your story (owner, 2026-07-16).
                                    Only for real image/video attachments: a text
                                    message has nothing to reshare, and Reels
                                    only ever carries a video (the sheet drops
                                    that row for a photo). The SENDER's
                                    allow_reshare switch is enforced server-side
                                    in /api/reshare, so this row appearing never
                                    means the action is guaranteed — a refusal
                                    comes back as a toast with the reason. */}
                                {(() => {
                                  const media = m.attachments.find((a) => a.kind === "image" || a.kind === "video");
                                  if (!media || m.deletedAt || m.id.startsWith("optimistic-")) return null;
                                  const allowed = reshareAllowed[m.id] ?? m.allowReshare;
                                  return (
                                    <>
                                      {/* Save to the device's own storage
                                          (owner, 2026-07-16). Always available
                                          to anyone who can already SEE the
                                          media — unlike Reshare, saving is not
                                          gated on the sender's switch: that
                                          switch is about republishing to other
                                          people, and someone looking at a photo
                                          can screenshot it regardless. Gating
                                          it would be theatre. */}
                                      <MenuItem
                                        icon={Download}
                                        label="Save to device"
                                        onClick={() => void saveMedia(media.url, media.kind as "image" | "video", media.filename)}
                                      />
                                      {/* The SENDER's own switch (owner: "users
                                          who ... sent the media in chat can set
                                          the media to be reshare or not"). Only
                                          on your own message; the server also
                                          enforces authorship in its WHERE. */}
                                      {m.mine ? (
                                        <MenuItem
                                          icon={allowed ? Repeat2 : Ban}
                                          label={allowed ? "Turn off resharing" : "Allow resharing"}
                                          onClick={() => void toggleMessageReshare(m.id, !allowed)}
                                        />
                                      ) : null}
                                      {/* A recipient only sees Reshare when the
                                          sender allows it — hidden, not greyed:
                                          a disabled row would advertise an
                                          action that can never succeed. The
                                          sender can always reshare their own. */}
                                      {m.mine || allowed ? (
                                        <MenuItem
                                          icon={Repeat2}
                                          label="Reshare"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            setResharing({
                                              messageId: m.id,
                                              attachmentId: media.id,
                                              kind: media.kind as "image" | "video",
                                              previewUrl: media.kind === "image" ? media.url : (media.thumbnailUrl ?? null),
                                            });
                                          }}
                                        />
                                      ) : null}
                                    </>
                                  );
                                })()}
                                {canEdit ? <MenuItem icon={Pencil} label="Edit" onClick={() => startEdit(m)} /> : null}
                                {canDelete ? (
                                  <MenuItem icon={Trash2} label="Delete" tone="danger" onClick={() => deleteMsg(m.id)} />
                                ) : null}
                              </div>
                            </>,
                            document.body,
                          )
                        : null}
                    </div>
                  ) : null}
                </SwipeToReply>

                {reactingId === m.id ? (
                  <div className="relative mt-1">
                    {/* Backdrop so the picker can be dismissed without forcing
                        an emoji pick — previously the only way to close it. */}
                    <button
                      type="button"
                      aria-label="Close reactions"
                      onClick={() => setReactingId(null)}
                      className="fixed inset-0 z-40 cursor-default"
                    />
                    <div className="glass animate-scale-in relative z-50 flex items-center gap-1 rounded-full px-2 py-1 shadow-sm">
                      {MESSAGE_REACTIONS.map((emoji) => (
                        <motion.button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            haptic("selection");
                            react(m.id, emoji);
                          }}
                          aria-label={`React ${emoji}`}
                          whileTap={{ scale: 0.75 }}
                          whileHover={{ scale: 1.2 }}
                          transition={springs.press}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-base"
                        >
                          {emoji}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {!m.deletedAt && m.reactions.length > 0 ? (
                  <div className={cn("mt-0.5 flex flex-wrap gap-1 px-1", m.mine ? "justify-end" : "justify-start")}>
                    {m.reactions.map((rx) => (
                      <motion.button
                        key={rx.emoji}
                        type="button"
                        onClick={() => {
                          haptic("light");
                          react(m.id, rx.emoji);
                        }}
                        whileTap={{ scale: 0.85 }}
                        transition={springs.press}
                        className={cn(
                          "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]",
                          rx.mine ? "border-violet-500/50 bg-violet-500/10" : "border-border/60 bg-secondary/60",
                        )}
                      >
                        <span>{rx.emoji}</span>
                        {rx.count > 1 ? <span className="text-muted-foreground">{rx.count}</span> : null}
                      </motion.button>
                    ))}
                  </div>
                ) : null}

                {/*
                  Under the bubble: ONLY a problem (2026-09-13). The time and
                  the ticks moved inside the bubble — see `bubbleMeta` above.
                  A queued or failed send still needs a line the member cannot
                  miss, and it keeps the owner's 2026-07-15 rule: the same
                  flex-row layout in every state, never a layout change.
                */}
                {groupMeta && !isFailed && !isQueued ? <span className="mt-1 flex">{groupMeta}</span> : null}
                {isFailed || isQueued ? (
                  <span className="mt-0.5 flex flex-row items-center gap-1 px-1 text-[10px] text-muted-foreground" suppressHydrationWarning>
                    {isFailed ? (
                      <span className="flex flex-row items-center gap-1 font-medium text-rose-500">
                        <AlertTriangle className="h-3 w-3" /> Failed to send
                      </span>
                    ) : (
                      <span className="flex flex-row items-center gap-1 font-medium text-muted-foreground">
                        <Clock className="h-3 w-3" /> Waiting to send…
                      </span>
                    )}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {replyingTo || editingId ? (
        <div className="flex items-center gap-2 border-t border-border/60 bg-secondary/40 px-4 py-2 text-xs">
          {editingId ? <Pencil className="h-3.5 w-3.5 shrink-0 text-primary" /> : <ReplyIcon className="h-3.5 w-3.5 shrink-0 text-primary" />}
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <span className="font-semibold text-foreground">{editingId ? "Editing message" : "Replying"}</span>
            {replyingTo ? ` · ${replyingTo.deletedAt ? "Deleted message" : replyingTo.body || "Message"}` : null}
          </span>
          <button type="button" onClick={cancelReplyOrEdit} aria-label="Cancel" className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* Height-animated (not a hard conditional mount) so it fades smoothly
          in/out instead of snapping the composer up/down — spec: "No layout
          jumping. Reserve space below the message list." */}
      <AnimatePresence initial={false}>
        {typingNames.length > 0 ? (
          <motion.div
            key="typing"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden border-t border-border/60 bg-secondary/20"
          >
            <div className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-muted-foreground">
              <span className="flex gap-0.5" aria-hidden>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
              </span>
              {typingLabel(typingNames)}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {mentionMatches.length > 0 ? (
        <div className="glass-strong mx-3 mb-1 overflow-hidden rounded-2xl py-1">
          {mentionMatches.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => selectMention(m)}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition hover:bg-secondary"
            >
              {m.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white">
                  {m.displayName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium">{m.displayName}</span>{" "}
                <span className="text-muted-foreground">@{m.handle}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {pendingAttachments.length > 0 || uploadingCount > 0 ? (
        <div className="flex items-center gap-2 overflow-x-auto border-t border-border/60 bg-secondary/20 px-3 py-2">
          {pendingAttachments.map((a, i) => (
            <div key={i} className="relative shrink-0">
              {a.mediaKind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.mediaUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
              ) : a.mediaKind === "video" ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={a.mediaUrl} muted className="h-16 w-16 rounded-xl bg-black object-cover" />
              ) : (
                <div className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl bg-secondary px-1.5 text-center">
                  <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="w-full truncate text-[9px] text-muted-foreground">{a.filename ?? "File"}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removePendingAttachment(i)}
                aria-label="Remove attachment"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-background text-muted-foreground shadow ring-1 ring-border/60 transition hover:text-rose-500"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {uploadingCount > 0 ? (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-secondary">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}
        </div>
      ) : null}

      {sendLocked ? (
        <div className="flex items-center justify-center gap-1.5 border-t border-border/60 bg-card/70 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-xs font-medium text-muted-foreground backdrop-blur-xl lg:pb-4">
          <Lock className="h-3.5 w-3.5 shrink-0" /> Only admins can send messages in this group
        </div>
      ) : recordingVoice ? (
        <div className={cn("border-t border-border/60 bg-card/70 p-3 backdrop-blur-xl lg:pb-3", composerBottomPad)}>
          <VoiceRecorder
            onRecorded={handleVoiceRecorded}
            onCancel={() => {
              setRecordingVoice(false);
              setHoldGesture(null);
              setAutoStopAndSend(false);
            }}
            holdGesture={holdGesture}
            autoStopAndSend={autoStopAndSend}
          />
        </div>
      ) : (
        /*
          🔴 WHATSAPP-STYLE, EXACTLY (owner, 2026-08-16, with a reference
          screenshot: "make the chat bottom and placeholder to be like this
          WhatsApp style exactly, including the blur and everything").

          Three changes from the previous "owner mockup" build, each pulled
          straight from the reference: (1) the attach control is a bare "+"
          with no filled circle behind it, not a paperclip in a glass/grey
          disc; (2) the mic is no longer a permanent icon living inside the
          pill next to the gallery button; (3) the single circular button
          outside the pill's right edge now SWAPS between mic and send based
          on whether there's anything to send — mic when the composer is
          empty, send the moment there's text or an attachment — which is
          the actual WhatsApp behavior (one control, two jobs), not two
          separate always-visible buttons. `hasContent` is the one flag both
          the button's icon/label and its handlers switch on. Blur was
          already here (`backdrop-blur-xl`) — untouched.
        */
        <form
          onSubmit={submit}
          className={cn(
            "frenz-message-composer flex items-end gap-2 border-t border-frenz-line px-3 pt-2.5 backdrop-blur-xl lg:pb-3",
            composerBottomPad,
            // Translucent (not solid) over a wallpaper — same "top 0 bottom 0"
            // full-bleed ask as the message list above: the shared image
            // painted behind the whole thread shows through here instead of
            // being cropped off by a solid bar.
            liveWallpaperUrl ? "bg-white/70" : useLightDefault ? "bg-white" : "bg-card/70",
          )}
        >
          <motion.button
            type="button"
            onClick={() => setMediaSheetOpen(true)}
            aria-label="Attach"
            whileTap={{ scale: 0.85 }}
            transition={springs.press}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-frenz-fill text-frenz-ink transition hover:bg-frenz-line"
          >
            <Plus className="h-5 w-5" strokeWidth={2.4} />
          </motion.button>
          <div
            className={cn(
              "flex min-h-[46px] min-w-0 flex-1 items-end rounded-[23px] pl-4 pr-1.5 transition focus-within:ring-2 focus-within:ring-frenz-violet/30",
              useLightDefault || liveWallpaperUrl ? "border border-frenz-line bg-frenz-fill" : "glass",
            )}>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                checkMentionTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length);
                if (e.target.value.trim()) onComposerTyping();
                else clearTyping();
              }}
              onKeyDown={onComposerKeyDown}
              // 🔴 "Send a chat" (owner, 2026-08-16, literal wording) — was
              // `Message ${otherFirstName}…` for a direct thread, then a
              // plain "Message". Edit/reply keep their own text: those
              // aren't decoration, they tell the sender which mode the
              // composer is actually in.
              placeholder={editingId ? "Edit your message…" : replyingTo ? "Write a reply…" : "Send a chat"}
              aria-label="Message"
              maxLength={2000}
              rows={1}
              // the keyboard's return key reads as a line break, not Send — Enter adds a line here (2026-10-22)
              enterKeyHint="enter"
              style={{ maxHeight: COMPOSER_MAX_HEIGHT }}
              className={cn(
                "max-h-32 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2.5 text-base leading-snug outline-none placeholder:text-frenz-muted",
                (useLightDefault || liveWallpaperUrl) && "text-neutral-900",
              )}
            />
            <EmojiPickerButton
              onPick={(emoji) => {
                const caret = textareaRef.current?.selectionStart ?? body.length;
                const next = `${body.slice(0, caret)}${emoji}${body.slice(caret)}`;
                setBody(next);
                if (next.trim()) onComposerTyping();
                requestAnimationFrame(() => {
                  const pos = caret + emoji.length;
                  textareaRef.current?.focus();
                  textareaRef.current?.setSelectionRange(pos, pos);
                });
              }}
            />
            {/* Part 6 (design screen 1): the sticker-gift button, beside the emoji picker — only where a gift can be sent */}
            {giftRecipients.length > 0 && !sendLocked ? <GiftComposerButton onOpen={() => { setGiftStickerId(null); setGiftOpen(true); }} /> : null}
            <motion.button
              type="button"
              onClick={() => setMediaSheetOpen(true)}
              aria-label="Add a photo or video"
              whileTap={{ scale: 0.85 }}
              transition={springs.press}
              className="flex h-11 w-9 shrink-0 items-center justify-center text-frenz-ink/80 transition hover:text-frenz-ink"
            >
              <CameraIcon size={20} strokeWidth={2} />
            </motion.button>
          </div>
          {body.trim() || pendingAttachments.length > 0 ? (
            <motion.button
              type="submit"
              disabled={busy || uploadingCount > 0}
              aria-label="Send"
              whileTap={{ scale: 0.88 }}
              transition={springs.press}
              className={cn(liveTheme ? THEME_BUBBLE_CLASS[liveTheme] : "bg-frenz-gradient-x", "flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full text-white shadow-frenz-card transition hover:opacity-95 disabled:opacity-40")}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendGlyph size={19} />}
            </motion.button>
          ) : (
            <motion.button
              type="button"
              onPointerDown={onMicPointerDown}
              onClick={() => {
                // A genuine hold (tracked via pointer events above) already
                // handled everything by the time this synthetic click fires
                // — only a plain tap/keyboard activation reaches here.
                if (micPointerHandledRef.current) return;
                setRecordingVoice(true);
              }}
              aria-label="Record voice message — tap to open, hold to record"
              whileTap={{ scale: 0.88 }}
              transition={springs.press}
              className={cn(liveTheme ? THEME_BUBBLE_CLASS[liveTheme] : "bg-frenz-gradient-x", "flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full text-white shadow-frenz-card transition hover:opacity-95")}
            >
              <MicIcon size={20} />
            </motion.button>
          )}
        </form>
      )}

      <MediaComposerSheet
        open={mediaSheetOpen}
        onClose={() => setMediaSheetOpen(false)}
        onFilesPicked={handleFilesPicked}
        onShareLocation={handleShareLocation}
        onOpenContactPicker={() => setContactPickerOpen(true)}
        onOpenPollComposer={() => setPollComposerOpen(true)}
        onSendCredits={creditsRecipient ? () => setSendCreditsOpen(true) : undefined}
        onSendGift={giftRecipients.length > 0 && !sendLocked ? () => setGiftOpen(true) : undefined}
      />
      {giftOpen ? <GiftSheet conversationId={conversationId} recipients={giftRecipients} requireChoice={type === "group"} initialStickerId={giftStickerId} onClose={() => { setGiftOpen(false); setGiftStickerId(null); }} onSent={() => void resync()} /> : null}
      {sendCreditsOpen && creditsRecipient ? <ChatSendCredits recipient={creditsRecipient} onClose={closeSendCredits} /> : null}
      <ContactPickerSheet open={contactPickerOpen} onClose={() => setContactPickerOpen(false)} onPick={handlePickContact} />
      <PollComposerSheet
        open={pollComposerOpen}
        onClose={() => setPollComposerOpen(false)}
        conversationId={conversationId}
        onCreated={() => void resync()}
      />
      {viewingImage ? <ImageLightbox src={viewingImage.url} alt={viewingImage.alt} onClose={() => setViewingImage(null)} /> : null}

      {/* Reshare chat media out to the feed / Reels / your story. Distinct from
          ForwardSheet below, which sends a message to ANOTHER CHAT — that's a
          different action with different rules, so they stay separate surfaces
          (see lib/social/reshare-rules.ts). */}
      {resharing ? (
        <ReshareSheet
          open
          onClose={() => setResharing(null)}
          source="message"
          sourceId={resharing.messageId}
          attachmentId={resharing.attachmentId}
          mediaKind={resharing.kind}
          previewUrl={resharing.previewUrl}
        />
      ) : null}

      <ForwardSheet
        messageId={forwardingId ?? ""}
        excludeConversationId={conversationId}
        open={!!forwardingId}
        onClose={() => setForwardingId(null)}
      />
    </>
  );
}

function typingLabel(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]} and ${names.length - 1} others are typing…`;
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition hover:bg-secondary",
        tone === "danger" ? "text-rose-500" : "text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
