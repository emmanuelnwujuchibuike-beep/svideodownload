"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronRight,
  Clock,
  File as FileIcon,
  Forward,
  Image as ImageIcon,
  Loader2,
  Lock,
  MapPin,
  Mic,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
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
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { RichText } from "@/components/social/rich-text";
import { revalidate } from "@/features/data";
import { ContactPickerSheet } from "@/features/social/contact-picker-sheet";
import { DocumentAttachmentCard } from "@/features/social/document-attachment-card";
import { EmojiPickerButton } from "@/features/social/emoji-picker-button";
import { ForwardSheet } from "@/features/social/forward-sheet";
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
import { haptic } from "@/lib/motion/haptics";
import { useLongPress } from "@/lib/dom/use-long-press";
import { springs } from "@/lib/motion/springs";
import { playSound } from "@/lib/notifications/sound-fx";
import { useNetworkStatus } from "@/lib/pwa/use-network-status";
import { BUBBLE_STYLE_SHAPE, type ChatAppearance } from "@/lib/social/chat-appearance";
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
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { useVisualViewport } from "@/lib/pwa/use-visual-viewport";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "@/features/ui/toast";

const COMPOSER_MAX_HEIGHT = 128;
const DRAFT_PREFIX = "frenz-draft:";
// Voice hold-to-record gesture thresholds (owner mockup).
const MIC_HOLD_COMMIT_MS = 200;
const MIC_CANCEL_PX = 80;
const MIC_LOCK_PX = 80;

/** Chat Themes (inbox mockup completion) — each drives BOTH an accent color
 *  (sent bubbles, send button) AND a matching background wash, per owner's
 *  explicit choice (the mockup itself only shows the color swatches). */
const THEME_BUBBLE_CLASS: Record<ConversationTheme, string> = {
  blue: "bg-gradient-to-br from-blue-500 to-blue-600",
  pink: "bg-gradient-to-br from-pink-500 to-rose-600",
  green: "bg-gradient-to-br from-emerald-500 to-green-600",
  orange: "bg-gradient-to-br from-orange-500 to-amber-600",
  purple: "bg-gradient-to-br from-violet-500 to-purple-600",
};
// Owner ask (2026-07-14): "users can also set the whole message page theme"
// — a 5-6% tint read as barely-there, not like the theme actually applied to
// the page. Bumped to a genuinely visible wash while staying well clear of
// text-contrast issues (still a wash behind normal bubbles, not a solid fill).
const THEME_WASH_CLASS: Record<ConversationTheme, string> = {
  blue: "bg-blue-500/[0.12] dark:bg-blue-400/[0.14]",
  pink: "bg-pink-500/[0.12] dark:bg-pink-400/[0.14]",
  green: "bg-emerald-500/[0.12] dark:bg-emerald-400/[0.14]",
  orange: "bg-orange-500/[0.12] dark:bg-orange-400/[0.14]",
  purple: "bg-violet-500/[0.12] dark:bg-violet-400/[0.14]",
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
interface ThreadCacheEntry {
  messages: MessageItem[];
  syncedAt: string;
}
const THREAD_CACHE_LIMIT = 10;
const threadCache = new Map<string, ThreadCacheEntry>();

function cacheThread(conversationId: string, entry: ThreadCacheEntry) {
  threadCache.delete(conversationId); // re-insert so Map's insertion order tracks MRU
  threadCache.set(conversationId, entry);
  if (threadCache.size > THREAD_CACHE_LIMIT) {
    const oldestKey = threadCache.keys().next().value;
    if (oldestKey) threadCache.delete(oldestKey);
  }
}

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
  viewerTypingIndicatorsEnabled = true,
  otherStoryGroup = null,
  initialAppearance,
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
  type?: ConversationType;
  members?: ConversationMember[];
  viewerRole?: MemberRole | null;
  onlyAdminsCanSend?: boolean;
  /** Direct threads: the other party's display name (drives the mockup's
   *  personalized "Message Maya…" composer placeholder). */
  otherName?: string | null;
  /** Part 11b privacy toggle — the VIEWER's own "show when I'm typing" choice; false mutes OUR OWN outbound typing broadcast only (receiving others' typing is unaffected). */
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
  const cachedThread = threadCache.get(conversationId);
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
  const bubbleShape = BUBBLE_STYLE_SHAPE[chatAppearance.bubbleStyle];
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
  const [uploadingCount, setUploadingCount] = useState(0);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [mediaSheetOpen, setMediaSheetOpen] = useState(false);
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

  const { typingNames, notifyTyping, clearTyping } = useTypingIndicator(conversationId, viewerId, viewerName, viewerTypingIndicatorsEnabled);
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

  // Mockup's personalized composer placeholder ("Message Maya…") — first
  // name of the other party, direct threads only. (`members` is empty for
  // direct threads — getConversation only fills it for groups — so this
  // comes from the dedicated otherName prop.)
  const otherFirstName = type === "direct" && otherName ? (otherName.split(" ")[0] ?? null) : null;

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
        if (!m.mine) {
          welcomedIds.current.add(m.id);
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
            const copy = prev.slice();
            copy[idx] = m;
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
  const { height: viewportHeight } = useVisualViewport();
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, viewportHeight]);

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
  const resyncing = useRef(false);
  const resync = useCallback(async () => {
    if (resyncing.current) return;
    resyncing.current = true;
    try {
      const res = await fetch(`/api/messages/${conversationId}?since=${encodeURIComponent(lastSyncedAt.current)}`, { cache: "no-store" });
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
            cur.reactions.length !== m.reactions.length ||
            cur.reactions.some((r, i) => r.count !== m.reactions[i]?.count || r.mine !== m.reactions[i]?.mine)
          ) {
            changed = true;
          }
          byId.set(m.id, m);
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
    }
  }, [conversationId]);

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
          if (!cancelled) {
            const delay = Math.min(1000 * firstAttemptFailures, 5000);
            window.setTimeout(() => {
              if (!cancelled) channel.subscribe(onSubscribeStatus);
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
    // Enter sends; Shift+Enter (or any IME composition) inserts a newline —
    // the standard chat-app convention, now meaningful since this is a real
    // multi-line textarea instead of a single-line input.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
        }
        setPendingAttachments((prev) => [
          ...prev,
          {
            mediaKind: resolvedKind,
            mediaUrl: url,
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
          // The action menu is now `fixed` (see toggleMessageMenu) so it can
          // clamp itself to the viewport — but that means it no longer
          // scrolls with its message, so it must close instead of visually
          // drifting away from the bubble it belongs to.
          if (openMenuId) setOpenMenuId(null);
        }}
        className={cn(
          "frenz-thread-scroll flex-1 space-y-1.5 overflow-x-hidden overflow-y-auto overscroll-y-none p-4",
          // Owner ask, 2026-07-14: "i want it to save and full screen, top 0
          // bottom 0 just like chat theme" — the wallpaper image itself now
          // paints on ThreadAppearanceProvider's shared outer container (see
          // that file), spanning the header + this list + the composer in
          // one continuous photo instead of being cropped to just this box.
          // This box stays transparent so it shows through.
          liveWallpaperUrl ? "bg-transparent" : useLightDefault ? "bg-white" : liveTheme ? THEME_WASH_CLASS[liveTheme] : undefined,
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
                {liveOtherStoryGroup.stories[0]?.mediaKind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={liveOtherStoryGroup.stories[0].mediaUrl} alt="" className="h-full w-full rounded-full object-cover" />
                ) : liveOtherStoryGroup.stories[0]?.mediaKind === "video" ? (
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
            const showDayDivider = !prevMsg || !sameDay(prevMsg.createdAt, m.createdAt);
            const showReceipt = m.mine && m.id === lastMineId && !m.id.startsWith("optimistic-");
            const r = showReceipt ? receiptLabel(m) : null;
            const clientIdOfBubble = m.id.startsWith("optimistic-") ? m.id.slice("optimistic-".length) : null;
            const isQueued = clientIdOfBubble ? queuedIds.has(clientIdOfBubble) : false;
            const isFailed = clientIdOfBubble ? failedIds.has(clientIdOfBubble) : false;
            const deleted = !!m.deletedAt;
            // A shared post link renders as a rich preview card (creator,
            // cover, caption) with any note above it — never a raw URL.
            const shared = !deleted ? extractSharedPost(m.body) : null;
            // Image/video attachments go edge-to-edge in the bubble (same
            // tight p-1.5 treatment as a shared-post embed); voice/document
            // attachments stay in the normal padded card layout since
            // they're compact rows, not full-bleed media.
            const hasMediaAttachment = m.attachments.some((a) => a.kind === "image" || a.kind === "video");
            const locationMeta = !deleted && m.metadata?.kind === "location" ? (m.metadata as { lat: number; lng: number; label: string | null }) : null;
            const contactMeta =
              !deleted && m.metadata?.kind === "contact"
                ? (m.metadata as { friendId: string; displayName: string; handle: string; avatarUrl: string | null })
                : null;
            const pollMeta = !deleted && m.metadata?.kind === "poll" ? (m.metadata as { pollId: string }) : null;
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
                        "w-full self-stretch py-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60",
                        (useLightDefault || liveWallpaperUrl) && "!text-neutral-500",
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
                  welcomedIds.current.has(m.id) && "animate-fade-up",
                )}
              >
                {showDayDivider ? (
                  // The mockup's centered "TODAY" divider between day groups.
                  <div
                    className={cn(
                      "w-full self-stretch py-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60",
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
                <div className={cn("flex max-w-[80%] items-end gap-1", m.mine ? "flex-row-reverse" : "flex-row")}>
                  <div
                    // Press-and-hold target (owner, 2026-07-16). `data-message-id`
                    // is how the single shared hook above knows WHICH bubble was
                    // held. Handlers only attach when there are actions to show,
                    // so a deleted/optimistic bubble stays inert rather than
                    // opening an empty menu.
                    data-message-id={m.id}
                    {...(canAct ? holdBubble : {})}
                    style={m.mine && !deleted && chatAppearance.bubbleColor ? { backgroundImage: "none", backgroundColor: chatAppearance.bubbleColor } : undefined}
                    className={cn(
                      "frenz-message-bubble min-w-0 max-w-full overflow-hidden whitespace-pre-wrap break-words leading-relaxed",
                      // A hold must open OUR menu, not iOS's text-selection
                      // callout — the two race otherwise and the system one
                      // wins. Copy stays available from the menu itself.
                      canAct && "select-none [-webkit-touch-callout:none]",
                      bubbleShape.base,
                      FONT_STYLE_CLASS[chatAppearance.fontStyle],
                      // "Speech tail" bubble style: a real protruding pointer
                      // (see the .chat-bubble-tail-* rules in globals.css),
                      // not a corner-radius pinch — needs `relative` to anchor
                      // the pseudo-element, and never on a deleted placeholder
                      // (dashed/transparent — a solid pointer would look wrong).
                      bubbleShape.protrudingTail && !deleted && "relative overflow-visible",
                      bubbleShape.protrudingTail && !deleted && (m.mine ? "chat-bubble-tail-mine" : "chat-bubble-tail-theirs"),
                      deleted ? "px-4 py-2.5 italic text-muted-foreground" : shared || hasMediaAttachment ? "p-1.5" : "px-4 py-2.5",
                      deleted
                        ? "border border-dashed border-border/60 bg-transparent"
                        : m.mine
                          ? cn(
                              // A personal bubble-color preference (set via the
                              // `style` prop above, `background-color`) beats
                              // the conversation theme's gradient class here —
                              // `bg-brand`/THEME_BUBBLE_CLASS still apply as the
                              // CSS class (so nothing regresses when no personal
                              // color is set), but an inline `background-color`
                              // always wins over a class in CSS specificity.
                              liveTheme ? THEME_BUBBLE_CLASS[liveTheme] : "bg-brand",
                              bubbleShape.tailMine,
                              "text-white shadow-md shadow-violet-500/20",
                            )
                          : // `.dark .glass` is a near-invisible white-on-white
                            // tint meant for a DARK backdrop — against the
                            // forced-light default/wallpaper background it
                            // read as an almost-blank bubble with white-on-
                            // white text. Explicit always-light colors here
                            // instead, matching WhatsApp's own received-bubble
                            // look, regardless of the app's own dark mode.
                            cn(
                              bubbleShape.tailTheirs,
                              useLightDefault || liveWallpaperUrl
                                ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-900/5"
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
                              m.mine ? "bg-white/15 text-white/85" : "bg-secondary text-muted-foreground",
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
                            href={`/u/${contactMeta.handle}`}
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
                        ) : null}
                        {m.attachments.length > 0 ? (
                          <div className={cn("flex flex-col gap-1.5", hasMediaAttachment ? "" : "px-0", m.body && "mb-1.5")}>
                            {m.attachments.map((att) =>
                              att.kind === "image" ? (
                                <button
                                  key={att.id}
                                  type="button"
                                  onClick={() => setViewingImage({ url: att.url, alt: att.filename ?? "Image" })}
                                  className="block overflow-hidden rounded-2xl"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={att.url} alt="" className="max-h-80 w-full max-w-full object-cover" />
                                </button>
                              ) : att.kind === "video" ? (
                                <VideoComment key={att.id} url={att.url} thumbnailUrl={att.thumbnailUrl} durationMs={att.durationMs} />
                              ) : att.kind === "audio" ? (
                                <VoiceMessage key={att.id} url={att.url} durationMs={att.durationMs} waveform={att.waveform} />
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
                          </>
                        ) : m.body ? (
                          <RichText
                            text={m.body}
                            linkClassName={cn("font-semibold underline underline-offset-2", m.mine ? "text-white" : "text-primary")}
                          />
                        ) : null}
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
                                className="fixed inset-0 z-40 cursor-default"
                              />
                              <div
                                style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
                                className="glass-strong animate-scale-in fixed z-50 overflow-hidden rounded-2xl py-1"
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
                </div>

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

                {/* Under-bubble meta, mockup format: "9:14 AM" under every
                    message; my most recent message shows "Seen 9:17 AM ✓"
                    instead (the receipt's own timestamp + a check). */}
                {/* Owner ask (2026-07-15): the status here — Sent, then
                    Delivered, then Seen — must stay laid out the exact same
                    way at every stage, never a plain inline span at one
                    stage and a flex row at another (a real risk before: the
                    very first "no receipt yet" instant had no flex classes
                    at all, unlike every other branch). `flex-row` is now
                    explicit (not just `flex`'s own default) on every single
                    branch so a state change is a pure content swap, never a
                    layout-direction change. */}
                <span className={cn("mt-0.5 flex flex-row items-center gap-1 px-1 text-[10px] text-muted-foreground")} suppressHydrationWarning>
                  {m.editedAt && !deleted ? <span>edited ·</span> : null}
                  {isFailed ? (
                    <span className="flex flex-row items-center gap-1 font-medium text-rose-500">
                      <AlertTriangle className="h-3 w-3" /> Failed to send
                    </span>
                  ) : isQueued ? (
                    <span className="flex flex-row items-center gap-1 font-medium text-muted-foreground">
                      <Clock className="h-3 w-3" /> Waiting to send…
                    </span>
                  ) : r ? (
                    // Owner receipt spec (2026-07-16), confirmed exactly:
                    //   Sent      -> ONE grey tick   (left our server, not yet on their device)
                    //   Delivered -> TWO BLUE ticks  ("when the user is online or just received it")
                    //   Seen      -> TWO GREEN ticks (they actually opened it)
                    // Only the colour changes between delivered and seen, so the
                    // state reads at a glance without counting ticks. Deliberately
                    // NOT `text-primary` for read (what it used to be): primary IS
                    // the same blue as delivered, so "delivered" and "seen" were
                    // literally indistinguishable before.
                    <span
                      className={cn(
                        "flex flex-row items-center gap-1 font-medium",
                        r.read
                          ? "text-emerald-500 dark:text-emerald-400"
                          : r.delivered
                            ? "text-blue-500 dark:text-blue-400"
                            : "text-muted-foreground",
                      )}
                    >
                      {r.label} {timeLabel(r.at)}
                      {r.delivered ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                    </span>
                  ) : (
                    <span className="flex flex-row items-center gap-1">{timeLabel(m.createdAt)}</span>
                  )}
                </span>
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
        <div className="border-t border-border/60 bg-card/70 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl lg:pb-3">
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
        // Composer, rebuilt to the owner's mockup: a glass attach circle, ONE
        // pill input that carries the gallery + mic buttons inside its right
        // edge, and an always-present circular gradient send button. The
        // placeholder is personalized ("Message Maya…") for direct threads,
        // exactly like the mockup.
        <form
          onSubmit={submit}
          className={cn(
            "frenz-message-composer flex items-end gap-2 border-t border-border/60 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl lg:pb-3",
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
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition",
              useLightDefault || liveWallpaperUrl ? "bg-neutral-100 text-neutral-500 hover:text-neutral-900" : "glass text-muted-foreground hover:text-foreground",
            )}
          >
            <Paperclip className="h-5 w-5" />
          </motion.button>
          <div
            className={cn(
              "flex min-w-0 flex-1 items-end rounded-[24px] pl-4 pr-1.5 transition focus-within:ring-2 focus-within:ring-violet-500/25",
              useLightDefault || liveWallpaperUrl ? "bg-neutral-100" : "glass",
            )}>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                checkMentionTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length);
                if (e.target.value.trim()) notifyTyping();
                else clearTyping();
              }}
              onKeyDown={onComposerKeyDown}
              placeholder={
                editingId
                  ? "Edit your message…"
                  : replyingTo
                    ? "Write a reply…"
                    : type === "direct" && otherFirstName
                      ? `Message ${otherFirstName}…`
                      : "Message…"
              }
              aria-label="Message"
              maxLength={2000}
              rows={1}
              style={{ maxHeight: COMPOSER_MAX_HEIGHT }}
              className={cn(
                "max-h-32 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60",
                (useLightDefault || liveWallpaperUrl) && "text-neutral-900",
              )}
            />
            <EmojiPickerButton
              onPick={(emoji) => {
                const caret = textareaRef.current?.selectionStart ?? body.length;
                const next = `${body.slice(0, caret)}${emoji}${body.slice(caret)}`;
                setBody(next);
                if (next.trim()) notifyTyping();
                requestAnimationFrame(() => {
                  const pos = caret + emoji.length;
                  textareaRef.current?.focus();
                  textareaRef.current?.setSelectionRange(pos, pos);
                });
              }}
            />
            <motion.button
              type="button"
              onClick={() => setMediaSheetOpen(true)}
              aria-label="Add a photo or video"
              whileTap={{ scale: 0.85 }}
              transition={springs.press}
              className="flex h-11 w-9 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground"
            >
              <ImageIcon className="h-5 w-5" />
            </motion.button>
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
              whileTap={{ scale: 0.85 }}
              transition={springs.press}
              className="flex h-11 w-9 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground"
            >
              <Mic className="h-5 w-5" />
            </motion.button>
          </div>
          <motion.button
            type="submit"
            disabled={busy || uploadingCount > 0 || (!body.trim() && pendingAttachments.length === 0)}
            aria-label="Send"
            whileTap={{ scale: 0.88 }}
            transition={springs.press}
            className={cn(liveTheme ? THEME_BUBBLE_CLASS[liveTheme] : "bg-brand", "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-md shadow-violet-500/30 transition hover:opacity-95 disabled:opacity-40")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 -translate-x-px" />}
          </motion.button>
        </form>
      )}

      <MediaComposerSheet
        open={mediaSheetOpen}
        onClose={() => setMediaSheetOpen(false)}
        onFilesPicked={handleFilesPicked}
        onShareLocation={handleShareLocation}
        onOpenContactPicker={() => setContactPickerOpen(true)}
        onOpenPollComposer={() => setPollComposerOpen(true)}
      />
      <ContactPickerSheet open={contactPickerOpen} onClose={() => setContactPickerOpen(false)} onPick={handlePickContact} />
      <PollComposerSheet
        open={pollComposerOpen}
        onClose={() => setPollComposerOpen(false)}
        conversationId={conversationId}
        onCreated={() => void resync()}
      />
      {viewingImage ? <ImageLightbox src={viewingImage.url} alt={viewingImage.alt} onClose={() => setViewingImage(null)} /> : null}

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
