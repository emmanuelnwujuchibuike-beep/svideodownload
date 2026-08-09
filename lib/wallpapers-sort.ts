import type { Wallpaper } from "./wallpapers";

/**
 * How the wallpaper library is ordered (owner, 2026-08-09: "make the wallpaper
 * page to show wallpaper based on time uploaded and users can change the sorting
 * to most liked, most viewed, alphabetically and any other sort").
 *
 * ── Pure, and separate from the component, so it can be tested ───────────────
 * Sort comparators are exactly the kind of code that looks obviously right and
 * is quietly wrong at the edges — a null date, two equal counts, an accented
 * first letter. None of that is visible by looking at a grid of pictures, so it
 * lives here with a test rather than inline in the JSX.
 */

export type WallpaperSort =
  | "newest"
  | "oldest"
  | "liked"
  | "viewed"
  | "downloaded"
  | "saved"
  | "az"
  | "za";

export interface SortSpec {
  key: WallpaperSort;
  label: string;
  /** Shown under the picker so the ordering is never a mystery. */
  hint: string;
}

/**
 * The order these appear in the picker. "Newest" leads because it is the
 * default the owner asked for — a library that never reorders looks abandoned,
 * and upload time is the one axis that always changes.
 */
export const WALLPAPER_SORTS: SortSpec[] = [
  { key: "newest", label: "Newest", hint: "Most recently uploaded first" },
  { key: "liked", label: "Most liked", hint: "Ranked by likes" },
  { key: "viewed", label: "Most viewed", hint: "Ranked by views" },
  { key: "downloaded", label: "Most downloaded", hint: "Ranked by real downloads" },
  { key: "saved", label: "Most saved", hint: "Ranked by saves" },
  { key: "az", label: "A → Z", hint: "Alphabetical by name" },
  { key: "za", label: "Z → A", hint: "Reverse alphabetical" },
  { key: "oldest", label: "Oldest", hint: "Earliest uploads first" },
];

export const DEFAULT_WALLPAPER_SORT: WallpaperSort = "newest";

export function isWallpaperSort(v: string | null | undefined): v is WallpaperSort {
  return !!v && WALLPAPER_SORTS.some((s) => s.key === v);
}

/**
 * Upload time as a sortable number.
 *
 * The built-in placeholders have no `createdAt` — they ship with the code and
 * were never uploaded. Giving them `0` puts them at the END of "Newest" and the
 * START of "Oldest", which is wrong in the second case: they are not the oldest
 * uploads, they are not uploads. So both date sorts push undated items to the
 * bottom regardless of direction, and `NaN` marks them.
 */
function uploadedAt(w: Wallpaper): number {
  if (!w.createdAt) return Number.NaN;
  const t = Date.parse(w.createdAt);
  return Number.isNaN(t) ? Number.NaN : t;
}

/**
 * Alphabetical, with `localeCompare` rather than `<`.
 *
 * A plain comparison sorts by UTF-16 code unit, which puts every uppercase
 * letter before every lowercase one ("Zebra" before "apple") and scatters
 * accented names away from their base letter. `numeric` also makes "Wallpaper
 * 10" sort after "Wallpaper 9" instead of before it, which is what anyone
 * naming a series expects.
 */
function byName(a: Wallpaper, b: Wallpaper): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

/**
 * Sorts a copy — never the input array.
 *
 * The gallery holds its items in React state; sorting in place would mutate that
 * array and produce a render that does not match what the component believes it
 * rendered.
 *
 * Every count sort falls back to NAME on a tie, not to the original order. Ties
 * are the normal case here (a new library is full of zeroes), and an unstable-
 * looking shuffle between renders reads as a bug even when the ranking is right.
 */
export function sortWallpapers(items: Wallpaper[], sort: WallpaperSort): Wallpaper[] {
  const out = [...items];
  const byCount = (pick: (w: Wallpaper) => number) => (a: Wallpaper, b: Wallpaper) =>
    pick(b) - pick(a) || byName(a, b);

  switch (sort) {
    case "newest":
    case "oldest": {
      const dir = sort === "newest" ? -1 : 1;
      return out.sort((a, b) => {
        const ta = uploadedAt(a);
        const tb = uploadedAt(b);
        // Undated items sink to the bottom in BOTH directions — see uploadedAt.
        const na = Number.isNaN(ta);
        const nb = Number.isNaN(tb);
        if (na && nb) return byName(a, b);
        if (na) return 1;
        if (nb) return -1;
        return ta === tb ? byName(a, b) : (ta - tb) * dir;
      });
    }
    case "liked":
      return out.sort(byCount((w) => w.likes));
    case "viewed":
      return out.sort(byCount((w) => w.views));
    case "downloaded":
      return out.sort(byCount((w) => w.downloads));
    case "saved":
      return out.sort(byCount((w) => w.saves));
    case "az":
      return out.sort(byName);
    case "za":
      return out.sort((a, b) => byName(b, a));
  }
}
