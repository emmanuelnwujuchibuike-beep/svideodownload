"use client";

/*
  The recipient's "Say thanks" on a gift, as the chat shows it (owner, 2026-10-28: "when a user clicks Say thanks, the
  sender sees a decorated thank you message"). A real message row (metadata.kind "gift_thanks": the gift's id, name and
  count — app/api/messages/route.ts), drawn as a small celebration card in the reveal's colours: confetti, the sticker
  in a halo, "Thank you!" and what it was for.

  The sticker art comes from the gift message already in this thread (looked up by the caller) — the thanks row itself
  carries no picture URL, so nothing a member types can point another member's phone at an outside image. No art (the
  gift scrolled out of the loaded history) falls back to a heart.
*/

export interface GiftThanksMeta {
  giftId?: string;
  name?: string;
  quantity?: number;
}

const DOTS: { x: number; y: number; w: number; h: number; c: string; r: number }[] = [
  { x: 10, y: 14, w: 8, h: 4, c: "#FBBF2E", r: 30 },
  { x: 84, y: 10, w: 9, h: 4, c: "#FF6C8C", r: -25 },
  { x: 90, y: 46, w: 6, h: 6, c: "#8FE3FF", r: 0 },
  { x: 6, y: 52, w: 7, h: 3, c: "#B9A6FF", r: -40 },
  { x: 22, y: 30, w: 5, h: 5, c: "#FFD15C", r: 0 },
  { x: 74, y: 28, w: 5, h: 5, c: "#FF6C8C", r: 0 },
];

export function thanksBody(name: string, quantity: number): string {
  return `Thank you for the ${name}${quantity > 1 ? ` ×${quantity}` : ""}!`;
}

export function GiftThanksBubble({ meta, mine, art, senderName, otherName }: { meta: GiftThanksMeta; mine: boolean; art: string | null; senderName: string; otherName: string }) {
  const name = meta.name ?? "gift";
  const count = Math.max(1, Math.trunc(meta.quantity ?? 1));
  const line = mine ? `You thanked ${otherName} for the ${name}` : `${senderName} loved your ${name}`;
  return (
    <div role="group" aria-label={`${line}${count > 1 ? `, ${count} times` : ""}`} className="relative flex w-56 max-w-full flex-col items-center overflow-hidden rounded-[22px] px-3 pb-3.5 pt-4 text-center text-white shadow-frenz-card">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,hsl(var(--frenz-violet)),hsl(var(--frenz-blue))_70%)]" />
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none">
        {DOTS.map((p, i) => (
          <rect key={i} x={`${p.x}%`} y={`${p.y}%`} width={p.w} height={p.h} rx={1.5} fill={p.c} transform={`rotate(${p.r})`} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
        ))}
      </svg>
      <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.4),transparent_68%)]">
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element -- the gifted sticker, from the gift message in this thread
          <img src={art} alt="" className="h-20 w-20 object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.3)] motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-500" />
        ) : (
          <svg width="44" height="44" viewBox="0 0 24 24" fill="#FF6C8C" aria-hidden>
            <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4h2c.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" />
          </svg>
        )}
        <svg width="26" height="26" viewBox="0 0 24 24" fill="#FF6C8C" stroke="#fff" strokeWidth="1.6" aria-hidden className="absolute -right-1 bottom-1 motion-safe:animate-pulse">
          <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4h2c.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" />
        </svg>
      </span>
      <span className="relative mt-1.5 font-heading text-[22px] font-extrabold leading-tight tracking-tight">Thank you!</span>
      <span className="relative mt-0.5 text-[13px] font-semibold text-white/90">
        for the {name}
        {count > 1 ? ` ×${count}` : ""}
      </span>
      <span className="relative mt-2 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md">{line}</span>
    </div>
  );
}
