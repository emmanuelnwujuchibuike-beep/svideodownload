/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ GIFT COIN — THE STICKER CATALOGUE (Frenz Gift Coin Part 3, migration 0291)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure (client-safe). The shape of a sticker and the field rules — the SAME rules 0291's gift_sticker_field_problem
 * enforces in the database, which is the authority (the admin route checks here first only to name the field).
 * The fields follow design/sticker-gifts.html: a name, a description, a rarity tag (Rare and above are tagged), a price
 * in coins, a category for the gallery chips, a featured flag for the banner, a static image for the grid and an
 * optional animated one for the stage, the bubble and the reveal.
 *
 * Prices are FGC MINOR units (1 FGC = 100), like every FGC amount. No price exists until an administrator sets one.
 * A gift (Part 4) records the sticker id AND its revision, so a later edit, re-price, unpublish or archive never
 * changes what a completed gift was (gift_sticker_revisions is append-only).
 */

export type StickerRarity = "common" | "rare" | "epic" | "legendary";
export const STICKER_RARITIES: readonly StickerRarity[] = ["common", "rare", "epic", "legendary"];

export interface GiftSticker {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rarity: StickerRarity;
  /** FGC minor units */
  priceFgc: number;
  imageUrl: string | null;
  animationUrl: string | null;
  category: string | null;
  featured: boolean;
  published: boolean;
  sortOrder: number;
  archivedAt: string | null;
  revision: number;
  updatedAt: string;
}

/** What an administrator may send (a create needs slug, name and price). The slug is fixed once made. */
export interface StickerFields {
  slug?: string;
  name?: string;
  description?: string | null;
  rarity?: StickerRarity;
  priceFgc?: number;
  imageUrl?: string | null;
  animationUrl?: string | null;
  category?: string | null;
  featured?: boolean;
  published?: boolean;
  sortOrder?: number;
  archived?: boolean;
}

export const STICKER_LIMITS = { nameMax: 40, descriptionMax: 200, priceMin: 1, priceMax: 99_999_999_999, sortMax: 100_000 } as const;
const SLUG = /^[a-z0-9][a-z0-9-]{1,47}$/;
const CATEGORY = /^[a-z0-9][a-z0-9-]{0,23}$/;
const HTTPS = /^https:\/\/[^\s"<>]{1,2040}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The first field that is not acceptable, worded for the admin — null when every field is. */
export function stickerFieldProblem(f: StickerFields, creating: boolean): { field: keyof StickerFields; message: string } | null {
  if (creating && (f.slug === undefined || f.name === undefined || f.priceFgc === undefined)) {
    const field = f.slug === undefined ? "slug" : f.name === undefined ? "name" : "priceFgc";
    return { field, message: "A new sticker needs a slug, a name and a price." };
  }
  if (!creating && f.slug !== undefined) return { field: "slug", message: "The slug can't change once a sticker exists." };
  if (f.slug !== undefined && !SLUG.test(f.slug)) return { field: "slug", message: "2–48 lowercase letters, numbers and dashes, starting with a letter or number." };
  if (f.name !== undefined && (f.name.trim().length < 1 || f.name.trim().length > STICKER_LIMITS.nameMax || CONTROL.test(f.name))) return { field: "name", message: `A name of 1 to ${STICKER_LIMITS.nameMax} characters.` };
  if (f.description !== undefined && f.description !== null && (f.description.length > STICKER_LIMITS.descriptionMax || CONTROL.test(f.description))) return { field: "description", message: `At most ${STICKER_LIMITS.descriptionMax} characters, on one line.` };
  if (f.rarity !== undefined && !STICKER_RARITIES.includes(f.rarity)) return { field: "rarity", message: "Choose a rarity." };
  if (f.priceFgc !== undefined && !(Number.isSafeInteger(f.priceFgc) && f.priceFgc >= STICKER_LIMITS.priceMin && f.priceFgc <= STICKER_LIMITS.priceMax)) return { field: "priceFgc", message: "A price of at least 0.01 FGC, in whole hundredths." };
  if (f.imageUrl !== undefined && f.imageUrl !== null && !HTTPS.test(f.imageUrl)) return { field: "imageUrl", message: "Upload the artwork again." };
  if (f.animationUrl !== undefined && f.animationUrl !== null && !HTTPS.test(f.animationUrl)) return { field: "animationUrl", message: "Upload the animation again." };
  if (f.category !== undefined && f.category !== null && !CATEGORY.test(f.category)) return { field: "category", message: "1–24 lowercase letters, numbers and dashes (e.g. love, fun, luxe)." };
  if (f.sortOrder !== undefined && !(Number.isSafeInteger(f.sortOrder) && f.sortOrder >= 0 && f.sortOrder <= STICKER_LIMITS.sortMax)) return { field: "sortOrder", message: `A whole number from 0 to ${STICKER_LIMITS.sortMax}.` };
  if (creating && f.archived) return { field: "archived", message: "A new sticker can't start archived." };
  if (creating && f.published && !f.imageUrl) return { field: "published", message: "Add artwork before publishing." };
  return null;
}

/** "12.50" FGC → 1250 minor units, exactly (no floating point). null when it isn't a price. */
export function parseFgc(text: string): number | null {
  const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return minor >= 1 ? minor : null;
}

/** 1250 → "12.50" */
export const formatFgc = (minor: number) => `${Math.floor(minor / 100).toLocaleString("en-US")}.${String(minor % 100).padStart(2, "0")}`;

/** A database row → the app's shape. */
export function stickerFromRow(r: Record<string, unknown>): GiftSticker {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    description: typeof r.description === "string" ? r.description : null,
    rarity: STICKER_RARITIES.includes(r.rarity as StickerRarity) ? (r.rarity as StickerRarity) : "common",
    priceFgc: Number(r.price_fgc),
    imageUrl: typeof r.image_url === "string" ? r.image_url : null,
    animationUrl: typeof r.animation_url === "string" ? r.animation_url : null,
    category: typeof r.category === "string" ? r.category : null,
    featured: r.featured === true,
    published: r.published === true,
    sortOrder: Number(r.sort_order ?? 0),
    archivedAt: typeof r.archived_at === "string" ? r.archived_at : null,
    revision: Number(r.revision ?? 1),
    updatedAt: String(r.updated_at ?? ""),
  };
}
