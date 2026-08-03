/**
 * The Identity settings fields — one table describing every drill-down row.
 *
 * The owner's reference (public/profile settings.jpg) is a LIST: each row shows
 * its current value and a chevron, and tapping it opens that field's own screen.
 * Declaring the rows once means the list page and the `[field]` sub-page can
 * never disagree about which fields exist, what they're called, or which tile
 * colour they carry — and an unknown `[field]` slug 404s instead of rendering a
 * blank editor.
 */

export type IdentityFieldKey =
  | "video"
  | "avatar"
  | "display-mode"
  | "visibility"
  | "name"
  | "username"
  | "bio"
  | "status"
  | "accent"
  | "links";

export interface IdentityFieldSpec {
  key: IdentityFieldKey;
  /** Which group it appears under on the list page. */
  group: "identity" | "details";
  title: string;
  /** Sub-line on the list row; the current VALUE is rendered separately. */
  description?: string;
  tag?: string;
  /** Lucide icon name, resolved by the UI so this stays render-free. */
  icon: string;
  tint: string;
  /** Longer explanation shown at the top of the field's own screen. */
  help?: string;
}

export const IDENTITY_FIELDS: IdentityFieldSpec[] = [
  {
    key: "video",
    group: "identity",
    title: "Profile video",
    tag: "Optional",
    description: "A ~3-second clip. Silent, loops. Under 20 MB.",
    icon: "Video",
    tint: "violet",
    help: "Uploading a video makes it what visitors see straight away. Remove it and your photo comes back.",
  },
  {
    key: "avatar",
    group: "identity",
    title: "Avatar image",
    tag: "Optional",
    description: "Show your style with an avatar image.",
    icon: "UserRound",
    tint: "blue",
    help: "An illustrated or generated stand-in for your photo. Uploading one makes it your display right away.",
  },
  {
    key: "display-mode",
    group: "identity",
    title: "Show on your profile",
    description: "Which identity visitors see by default.",
    icon: "Image",
    tint: "purple",
  },
  {
    key: "visibility",
    group: "identity",
    title: "Profile visibility",
    description: "Choose who can see your profile.",
    icon: "Eye",
    tint: "emerald",
  },
  { key: "name", group: "details", title: "Name", icon: "Pencil", tint: "amber" },
  {
    key: "username",
    group: "details",
    title: "Username",
    icon: "AtSign",
    tint: "purple",
    help: "Your @name and the address of your profile. Letters, numbers and underscores.",
  },
  { key: "bio", group: "details", title: "Bio", icon: "FileText", tint: "blue", help: "Up to 280 characters." },
  {
    key: "status",
    group: "details",
    title: "Status & mood",
    description: "A short line about what you're up to.",
    icon: "Smile",
    tint: "rose",
  },
  { key: "accent", group: "details", title: "Accent colour", description: "Shown on your profile.", icon: "Palette", tint: "violet" },
  { key: "links", group: "details", title: "Links", description: "Add your website or business link.", icon: "Link", tint: "cyan" },
];

const BY_KEY = new Map(IDENTITY_FIELDS.map((f) => [f.key, f]));

export function getIdentityField(key: string): IdentityFieldSpec | undefined {
  return BY_KEY.get(key as IdentityFieldKey);
}
