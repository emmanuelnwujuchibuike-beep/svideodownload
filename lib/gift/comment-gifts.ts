/**
 * A sticker gift shown in a post's comments (0304): the comment's `sticker` is `gf:<gift id>` — the same column that
 * holds an emoji sticker id or a `vs:<uuid>` video sticker (0303). Only the gift server writes it: the comment API
 * accepts emoji and video stickers only, so a member cannot post a gift card of their own.
 */
export const GIFT_COMMENT_PREFIX = "gf:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const giftCommentId = (giftId: string) => `${GIFT_COMMENT_PREFIX}${giftId}`;

export function giftCommentUuid(stickerId: string | null | undefined): string | null {
  if (!stickerId || !stickerId.startsWith(GIFT_COMMENT_PREFIX)) return null;
  const u = stickerId.slice(GIFT_COMMENT_PREFIX.length).toLowerCase();
  return UUID.test(u) ? u : null;
}

/** What a gift comment shows — the gift's own snapshot, never anything the comment says. */
export interface CommentGift {
  giftId: string;
  name: string;
  imageUrl: string | null;
  animationUrl: string | null;
  rarity: string;
  priceFgc: number;
  quantity: number;
  recipientName: string;
}
