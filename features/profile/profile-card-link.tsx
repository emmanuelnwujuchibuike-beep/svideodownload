import { QrCode } from "lucide-react";
import Link from "next/link";

/**
 * The way into the Digital Business Card (Part 18).
 *
 * It exists because a page nothing links to is a page nobody finds — this
 * codebase has shipped unreachable routes three times, and the card is exactly
 * the kind of surface that would have been the fourth: reachable only by
 * typing `/card` onto a URL.
 *
 * Sits beside Share rather than inside a menu: the card IS a way of sharing,
 * and burying it one tap deeper than the share sheet would mean nobody
 * discovers the QR exists.
 */
export function ProfileCardLink({ handle }: { handle: string }) {
  return (
    <Link
      href={`/u/${handle}/card`}
      prefetch={false}
      aria-label="Digital card and QR code"
      title="Digital card and QR code"
      /*
        `btn-lux-icon` REPLACES `btn-lux`; it is not composed with it. Using
        both let the base class's own background win, so the button rendered as
        a plain white circle with nothing readable in it (owner, 2026-08-04).

        The glyph is explicitly the brand blue rather than inheriting
        `muted-foreground`: inside the lux scope this sits on a white card
        behind a white gradient, and grey-on-white at 18px was the reason it
        read as empty. The lux brief's own rule for a secondary control —
        "white with light border, blue icon only" — is exactly right here.
      */
      className="btn-lux-icon lux-press !text-[#2563FF] dark:!text-[#7CA0FF]"
    >
      <QrCode className="h-[19px] w-[19px]" strokeWidth={2.2} />
    </Link>
  );
}
