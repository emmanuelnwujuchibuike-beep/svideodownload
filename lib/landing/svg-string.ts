import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import type { IconType } from "react-icons";

/**
 * An icon as an SVG string, for the landing's deferred sections (lib/landing/deferred-sections.ts),
 * which are plain HTML served from one cached address — no React renderer runs there.
 *
 * Both icon sets keep their drawing as data on the element they create, so this walks that data
 * rather than keeping a second copy of any path: lucide's `iconNode`, and react-icons' `attr` plus
 * child elements. Every glyph is decorative (`aria-hidden`), as `BRAND_ICONS` makes them elsewhere.
 */

type Attrs = Record<string, unknown>;

const esc = (v: unknown) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** camelCase React prop names to SVG attribute names (strokeWidth → stroke-width). */
const attrName = (k: string) => (k === "className" ? "class" : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

function attrs(a: Attrs) {
  return Object.entries(a)
    .filter(([k, v]) => k !== "key" && k !== "children" && k !== "role" && v != null && v !== false)
    .map(([k, v]) => ` ${attrName(k)}="${esc(v)}"`)
    .join("");
}

export function lucideSvg(Icon: LucideIcon, className: string): string {
  const el = (Icon as unknown as { render: (p: object, r: null) => ReactElement<{ iconNode: [string, Attrs][] }> }).render({}, null);
  const body = el.props.iconNode.map(([tag, a]) => `<${tag}${attrs(a)}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${esc(className)}" aria-hidden="true">${body}</svg>`;
}

type Node = ReactElement<Attrs & { children?: Node | Node[]; attr?: Attrs }>;

function children(n: Node): string {
  const kids = n.props.children;
  if (!kids) return "";
  // a production build leaves empty slots (undefined / false) among the children — skip them
  return (Array.isArray(kids) ? kids : [kids])
    .filter((c): c is Node => !!c && typeof c === "object" && "type" in c)
    .map((c) => (typeof c.type === "string" ? `<${c.type}${attrs(c.props)}>${children(c)}</${c.type}>` : ""))
    .join("");
}

export function brandSvg(Icon: IconType, className: string): string {
  // unwrap the decorative() wrapper (lib/platform-icons) and the icon fn down to react-icons' IconBase
  let el = (Icon as unknown as (p: object) => Node)({});
  // stop at the element that carries the drawing (`attr`) — never by function name, which minifying renames
  for (let i = 0; i < 4 && typeof el.type === "function" && !el.props.attr; i++) el = (el.type as (p: object) => Node)(el.props);
  const viewBox = el.props.attr?.viewBox ?? "0 0 24 24";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${esc(viewBox)}" fill="currentColor" stroke="currentColor" stroke-width="0" class="${esc(className)}" aria-hidden="true">${children(el)}</svg>`;
}
