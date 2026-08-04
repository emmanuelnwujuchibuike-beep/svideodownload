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
      className="btn-lux btn-lux-icon lux-press"
    >
      <QrCode className="h-[18px] w-[18px]" />
    </Link>
  );
}
