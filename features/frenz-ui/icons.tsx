import type { ReactNode } from "react";

/*
  The Frenz screens' icon set, drawn from the design files (design/*.dc.html) —
  24-unit outline glyphs, round caps and joins, `currentColor`. Every one is
  decorative (aria-hidden): the control around it carries the name.
*/

type GlyphProps = { size?: number; strokeWidth?: number | string; className?: string };

function Glyph({ size = 22, strokeWidth = 2.2, className, fill = "none", children }: GlyphProps & { fill?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={fill === "none" ? "currentColor" : "none"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: GlyphProps) => <Glyph {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></Glyph>;
export const FeedIcon = (p: GlyphProps) => <Glyph {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M10 9.5v5l4.5-2.5z" /></Glyph>;
export const HistoryIcon = (p: GlyphProps) => <Glyph {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></Glyph>;
export const ChatIcon = (p: GlyphProps) => <Glyph {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" /></Glyph>;
export const BellIcon = (p: GlyphProps) => <Glyph {...p}><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" /><path d="M10 20a2 2 0 0 0 4 0" /></Glyph>;
export const MegaphoneIcon = (p: GlyphProps) => <Glyph {...p}><path d="M3 10v4h3l7 5V5L6 10z" /><path d="M17 9a4 4 0 0 1 0 6" /><path d="M20 6.5a8 8 0 0 1 0 11" /></Glyph>;
export const LinkIcon = (p: GlyphProps) => <Glyph {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></Glyph>;
export const DownloadIcon = (p: GlyphProps) => <Glyph {...p}><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></Glyph>;
export const BatchIcon = (p: GlyphProps) => <Glyph {...p}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><path d="M17.5 14v7" /><path d="M14 17.5h7" /></Glyph>;
export const ChevronRightIcon = (p: GlyphProps) => <Glyph {...p}><path d="M9 6l6 6-6 6" /></Glyph>;
export const ChevronLeftIcon = (p: GlyphProps) => <Glyph {...p}><path d="M15 5l-7 7 7 7" /></Glyph>;
export const CloudIcon = (p: GlyphProps) => <Glyph {...p}><path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z" /></Glyph>;
export const CoinIcon = (p: GlyphProps) => <Glyph {...p}><circle cx="12" cy="12" r="9" /><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5" /></Glyph>;
export const CompassIcon = (p: GlyphProps) => <Glyph {...p}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></Glyph>;
export const LockIcon = (p: GlyphProps) => <Glyph {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Glyph>;
export const CheckIcon = (p: GlyphProps) => <Glyph {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Glyph>;
export const PlayIcon = (p: GlyphProps) => <Glyph {...p} fill="currentColor"><path d="M7 4l13 8-13 8z" /></Glyph>;
export const PauseIcon = (p: GlyphProps) => <Glyph {...p} fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></Glyph>;
export const PlusSquareIcon = (p: GlyphProps) => <Glyph {...p}><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M12 8v8" /><path d="M8 12h8" /></Glyph>;
export const PlusIcon = (p: GlyphProps) => <Glyph {...p}><path d="M12 5v14" /><path d="M5 12h14" /></Glyph>;
export const SearchIcon = (p: GlyphProps) => <Glyph {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></Glyph>;
export const DotsIcon = (p: GlyphProps) => <Glyph {...p} fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></Glyph>;
export const HeartIcon = ({ filled = false, ...p }: GlyphProps & { filled?: boolean }) => (
  <Glyph {...p} strokeWidth={p.strokeWidth ?? 2} fill={filled ? "currentColor" : "none"}><path d="M12 20.5s-8-4.7-8-10.6A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 8 2.6c0 5.9-8 10.6-8 10.6z" /></Glyph>
);
export const RepostIcon = (p: GlyphProps) => <Glyph {...p}><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></Glyph>;
export const SendIcon = (p: GlyphProps) => <Glyph {...p}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></Glyph>;
export const BookmarkIcon = ({ filled = false, ...p }: GlyphProps & { filled?: boolean }) => (
  <Glyph {...p} fill={filled ? "currentColor" : "none"}><path d="M6 3h12v18l-6-4-6 4z" /></Glyph>
);
export const MutedIcon = (p: GlyphProps) => <Glyph {...p}><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M17 9l4 6" /><path d="M21 9l-4 6" /></Glyph>;
export const SoundIcon = (p: GlyphProps) => <Glyph {...p}><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M17 9a4 4 0 0 1 0 6" /></Glyph>;
export const UserPlusIcon = (p: GlyphProps) => <Glyph {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6" /><path d="M16 11h6" /></Glyph>;
export const PencilIcon = (p: GlyphProps) => <Glyph {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Glyph>;
export const PinIcon = (p: GlyphProps) => <Glyph {...p}><path d="M9 3h6l-1 6 4 4H6l4-4z" /><path d="M12 13v8" /></Glyph>;
export const PhoneIcon = (p: GlyphProps) => <Glyph {...p}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></Glyph>;
export const VideoIcon = (p: GlyphProps) => <Glyph {...p}><rect x="3" y="6" width="13" height="12" rx="3" /><path d="M16 10.5l5-3v9l-5-3" /></Glyph>;
export const MicIcon = (p: GlyphProps) => <Glyph {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></Glyph>;
export const EmojiIcon = (p: GlyphProps) => <Glyph {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 14a4 4 0 0 0 7 0" /><path d="M9 9.5h.01" /><path d="M15 9.5h.01" /></Glyph>;
export const CameraIcon = (p: GlyphProps) => <Glyph {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></Glyph>;
export const ReadTicksIcon = (p: GlyphProps) => <Glyph {...p}><path d="M2 12l5 5L17 7" /><path d="M12 16l1 1L23 7" /></Glyph>;
export const CalendarIcon = (p: GlyphProps) => <Glyph {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" /></Glyph>;
export const FlameIcon = (p: GlyphProps) => <Glyph {...p}><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2-4.6.3 1.6 1.1 2.6 2.2 2.6C10.5 8.5 11 5.5 12 3z" /></Glyph>;
export const ShareUpIcon = (p: GlyphProps) => <Glyph {...p}><path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></Glyph>;
export const ListViewIcon = (p: GlyphProps) => <Glyph {...p}><rect x="4" y="4" width="16" height="7" rx="2" /><rect x="4" y="13" width="16" height="7" rx="2" /></Glyph>;
export const SparkIcon = (p: GlyphProps) => <Glyph {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></Glyph>;
