import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-09: "a genuinely floating Instagram/WhatsApp-inspired glass
 * bottom navigation with visible left and right margins … The navigation MUST
 * NOT extend from the left edge to the right edge of the screen … Do not attach
 * a full-width opaque background behind it."
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
// Comments stripped: the file DOCUMENTS the bar and the pulse it replaced.
const nav = code("features/app-shell/mobile-nav.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const css = code("app/globals.css");

/** The floating-pill rules as a function of the nav's source, so the teeth can run them on a broken copy. */
function floats(src: string): boolean {
  const wrapper = src.match(/"pointer-events-none fixed [^"]*"/)?.[0] ?? "";
  return (
    // inset from both edges, centred, capped — never edge to edge
    /\binset-x-0\b/.test(wrapper) &&
    /\bmx-auto\b/.test(wrapper) &&
    /\bw-\[calc\(100%-1\.75rem\)\]/.test(wrapper) &&
    /\bmax-w-\[560px\]/.test(wrapper) &&
    !/\bw-full\b/.test(wrapper) &&
    // above the home indicator, by the shared gap
    /\bbottom-\[var\(--frenz-nav-gap\)\]/.test(wrapper) &&
    // the bar: glass, fully round (design/frenz-exclusive-feed.html, owner 2026-10-31), a fixed height every page can reserve
    /"frenz-nav-glass frenz-ui pointer-events-auto relative flex h-\[var\(--frenz-nav-height\)\] min-w-0 flex-1[^"]*rounded-full/.test(src) &&
    // a SEPARATE round gradient button (Profile, 66 px) beside the bar, and a capsule on the active tab
    /h-\[66px\] w-\[66px\][^"]*rounded-full bg-\[linear-gradient\(135deg,#5B5BF0,#7B5CF0,#B86CF2\)\]/.test(src) &&
    /ACTIVE_CAPSULE/.test(src) &&
    // no opaque full-width slab left behind
    !/border-t border-border bg-background/.test(src) &&
    // nothing loops on the bar
    !/attract-loop|attract=/.test(src)
  );
}

describe("the floating glass bottom nav", () => {
  it("floats: inset from both edges, centred, capped at 560px, above the safe area", () => {
    expect(floats(nav)).toBe(true);
  });

  it("teeth: a full-width bar, an opaque slab, or the pulse coming back fails", () => {
    expect(floats(nav.replace("w-[calc(100%-1.75rem)]", "w-full"))).toBe(false);
    expect(floats(nav.replace("relative flex h-[var(--frenz-nav-height)] min-w-0 flex-1 items-center gap-0.5 rounded-full", "relative flex h-[var(--frenz-nav-height)] min-w-0 flex-1 items-center gap-0.5 rounded-none"))).toBe(false);
    expect(floats(nav.replace("rounded-full bg-[linear-gradient(135deg,#5B5BF0,#7B5CF0,#B86CF2)]", "rounded-[26px] bg-frenz-gradient"))).toBe(false);
    expect(floats(nav.replaceAll("ACTIVE_CAPSULE", "NO_CAPSULE"))).toBe(false);
    expect(floats(nav.replace("frenz-nav-glass frenz-ui pointer-events-auto", "border-t border-border bg-background pointer-events-auto"))).toBe(false);
    expect(floats(nav.replace("active={pathname === \"/home\"", "attract={true}\n            active={pathname === \"/home\""))).toBe(false);
  });

  it("is real glass with the .ai-glass fallback tiers, and nothing on it transitions", () => {
    const rule = css.match(/\.frenz-nav-glass \{[\s\S]*?\n {2}\}/)?.[0] ?? "";
    expect(rule).toMatch(/backdrop-filter: blur\(var\(--nav-glass-blur\)\)/);
    expect(rule).toMatch(/background-color: rgb\(var\(--nav-glass-rgb\) \/ var\(--nav-glass-fill\)\)/);
    expect(rule).not.toMatch(/transition|animation/);
    // reduced device / motion, no support, reduced transparency
    expect(css).toMatch(/html\[data-glass="reduced"\]\) \.frenz-nav-glass/);
    // Inside the SAME tier blocks as .ai-glass (one hierarchy, one source order).
    expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\n {4}\.ai-glass \{[^}]*\}\n {4}\.frenz-nav-glass \{\n {6}--nav-glass-fill: 0\.99;/);
    // 2026-10-31 design (design/frenz-exclusive-feed.html): #F4F3F8 at 92 %, 20 px blur, a white hairline and the soft drop
    expect(rule).toMatch(/--nav-glass-fill: 0\.92;/);
    expect(rule).toMatch(/--nav-glass-blur: 20px;/);
    expect(rule).toMatch(/box-shadow: 0 14px 30px -14px rgb\(14 14 18 \/ 0\.3\);/);
    expect(rule).not.toMatch(/rgb\(16 24 40/);
    const darkRule = css.match(/\.dark \.frenz-nav-glass \{[\s\S]*?\}/)?.[0] ?? "";
    expect(darkRule).toMatch(/-6px -6px 16px rgb\(255 255 255 \/ 0\.045\)/);
    expect(css).toMatch(/prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{\n {4}\.ai-glass \{[^}]*\}\n {4}\.frenz-nav-glass \{\n {6}--nav-glass-fill: 1;/);
    // the base rule comes BEFORE every tier, so the tiers win by source order
    expect(css.indexOf(".frenz-nav-glass {")).toBeLessThan(css.indexOf('html[data-glass="reduced"]) .frenz-nav-glass'));
    // the dark theme must not set the fill, or it would out-rank the tiers
    const dark = css.match(/\.dark \.frenz-nav-glass \{[\s\S]*?\}/)?.[0] ?? "";
    expect(dark).not.toMatch(/--nav-glass-fill/);
  });

  it("every surface reserves the same clearance the pill is built from", () => {
    expect(css).toMatch(/--frenz-nav-clearance: calc\(var\(--frenz-nav-height\) \+ var\(--frenz-nav-gap\)\);/);
    // low, but clear of the home indicator (owner: "it shouldn't float much too high")
    expect(css).toMatch(/--frenz-nav-gap: max\(0\.5rem, calc\(env\(safe-area-inset-bottom\) - 0\.75rem\)\);/);
    expect(code("features/app-shell/app-content.tsx")).toContain("pb-[calc(var(--frenz-nav-clearance)+1.5rem)]");
    expect(code("app/(app)/messages/layout.tsx")).toContain("h-[calc(100dvh-var(--frenz-nav-clearance))]");
    // the nav is on every marketing page again, for every visitor (owner, 2026-10-30), so its spacer is back in the layout
    expect(code("app/(marketing)/layout.tsx")).toContain("h-[calc(var(--frenz-nav-clearance)+0.75rem)] lg:hidden");
    expect(code("components/landing/mobile-app-nav.tsx")).toContain("return <MobileNav marketing />;");
  });

  it("the reel scrubber still sits above the pill (they are a pair)", () => {
    // nav top = 4.25rem + max(0.5rem, inset - 0.75rem) <= 4.75rem + inset (equal with no inset)
    expect(code("features/feed/reel-viewer.tsx")).toContain('"!bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:!bottom-4"');
    expect(css).toMatch(/--frenz-nav-height: 4\.25rem;/);
  });
});

describe("Support lives in the profile menu for members (owner, 2026-10-09)", () => {
  /*
    2026-10-18 (owner, Menu.dc.html): Support is "Help & support" in the menu's "More" list, and the
    footer is the Light / Dark / Auto switch and sign out. Still in the profile menu for members.
  */
  function supportInMore(src: string): boolean {
    return /const MORE[^=]*= \[[\s\S]*?\{ label: "Help & support", href: "\/support"/.test(src) && /\{\/\* Footer — Light \/ Dark \/ Auto and sign out \*\/\}[\s\S]{0,200}<ThemeToggle variant="segmented"/.test(src);
  }
  const menu = code("features/profile/profile-menu-panel.tsx");
  it("the menu carries Help & support in More, and the footer the theme switch", () => {
    expect(supportInMore(menu)).toBe(true);
  });
  it("teeth: Support missing from the menu fails", () => {
    expect(supportInMore(menu.replace('href: "/support"', 'href: "/help"'))).toBe(false);
  });
  // 2026-10-16 (owner): Support → Chats on the landing too; a guest gets an empty inbox and a sign-in modal
  const chatsForAll = (src: string) =>
    /\n\s*<NavTab label="Chats" href="\/messages"[^\n]*badge=\{handle \? unread : 0\}/.test(src) && !src.includes('<NavTab label="Support"');
  it("everyone's bottom nav has Chats; no Support tab", () => {
    expect(chatsForAll(nav)).toBe(true);
  });
  it("teeth: a Support tab back on the bar fails", () => {
    expect(chatsForAll(nav + '\n<NavTab label="Support" href="/support" />')).toBe(false);
  });
  it("a guest's chat page: no fetch, no avatar, no stories; actions ask to sign in", () => {
    const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    expect(read("features/social/instant-inbox.tsx")).toContain("return useIsGuest() ? <GuestInbox /> : <MemberInbox variant={variant} />;");
    expect(read("features/social/inbox-header-actions.tsx")).toContain("return guest ? <GuestHeaderActions /> : <MemberHeaderActions />;");
    expect(read("features/social/inbox-mobile-chrome.tsx")).toContain("{guest ? null : <InboxStoriesRow />}");
    const guestActions = read("features/social/inbox-header-actions.tsx").split("function GuestHeaderActions")[1]!.split("function MemberHeaderActions")[0]!;
    expect(guestActions).not.toContain("<UserMenu");
    expect(guestActions).toContain("<GuestSignInModal");
  });
});
