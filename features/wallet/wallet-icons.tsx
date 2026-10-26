import type { ReactNode } from "react";

/*
  The Frenz Coin wallet's glyphs, drawn from design/frenz-coin-wallet-design.zip (Main, Deposit, Transfer, Receipt,
  Withdraw) — the same 24-unit outline style as features/frenz-ui/icons.tsx. Decorative (aria-hidden): the control
  around each one carries its name.
*/
type GlyphProps = { size?: number; strokeWidth?: number; className?: string };

function Glyph({ size = 20, strokeWidth = 2.2, className, children }: GlyphProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {children}
    </svg>
  );
}

export const EyeIcon = (p: GlyphProps) => <Glyph {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Glyph>;
export const EyeOffIcon = (p: GlyphProps) => <Glyph {...p}><path d="M3 3l18 18" /><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.8 17.8 0 0 1-3.2 4.1" /><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.4-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Glyph>;
export const ShieldCheckIcon = (p: GlyphProps) => <Glyph {...p}><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></Glyph>;
export const CopyIcon = (p: GlyphProps) => <Glyph {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Glyph>;
export const DepositIcon = (p: GlyphProps) => <Glyph {...p}><path d="M12 4v12" /><path d="M6 11l6 6 6-6" /><path d="M5 20h14" /></Glyph>;
export const BankIcon = (p: GlyphProps) => <Glyph {...p}><path d="M3 10l9-6 9 6" /><path d="M5 10v8" /><path d="M10 10v8" /><path d="M14 10v8" /><path d="M19 10v8" /><path d="M3 21h18" /></Glyph>;
export const SendIcon = (p: GlyphProps) => <Glyph {...p}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></Glyph>;
export const LockIcon = (p: GlyphProps) => <Glyph {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Glyph>;
export const SearchIcon = (p: GlyphProps) => <Glyph {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Glyph>;
export const CloseIcon = (p: GlyphProps) => <Glyph {...p}><path d="M6 6l12 12" /><path d="M18 6L6 18" /></Glyph>;
export const PencilIcon = (p: GlyphProps) => <Glyph {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Glyph>;
export const InfoIcon = (p: GlyphProps) => <Glyph {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5" /><path d="M12 16h.01" /></Glyph>;
export const CheckIcon = (p: GlyphProps) => <Glyph {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Glyph>;
export const CheckCircleIcon = (p: GlyphProps) => <Glyph {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.8" /></Glyph>;
export const RefreshIcon = (p: GlyphProps) => <Glyph {...p}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></Glyph>;
export const ClockIcon = (p: GlyphProps) => <Glyph {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></Glyph>;
export const ReturnIcon = (p: GlyphProps) => <Glyph {...p}><path d="M9 14l-5-5 5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></Glyph>;
export const ArrowUpRightIcon = (p: GlyphProps) => <Glyph {...p}><path d="M7 17L17 7" /><path d="M8 7h9v9" /></Glyph>;
export const ChevronLeftIcon = (p: GlyphProps) => <Glyph {...p}><path d="M15 5l-7 7 7 7" /></Glyph>;
export const ChevronRightIcon = (p: GlyphProps) => <Glyph {...p}><path d="M9 6l6 6-6 6" /></Glyph>;
export const KeyIcon = (p: GlyphProps) => <Glyph {...p}><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3" /><path d="M16 7l3 3" /></Glyph>;
