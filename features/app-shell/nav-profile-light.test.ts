import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nav = readFileSync("features/app-shell/mobile-nav.tsx", "utf8");

// Owner, 2026-10-31: no profile picture on the nav's profile button — every page with the bar stays lighter.
function light(src: string): boolean {
  const button = src.slice(src.indexOf('aria-label="Profile"'), src.indexOf("</Link>", src.indexOf('aria-label="Profile"')));
  return (
    button.length > 0 &&
    !/<img\b/.test(button) &&
    !/avatarUrl/.test(src.match(/const \{[^}]*\} = useEntitlements\(\);/)?.[0] ?? "avatarUrl") &&
    /<CircleUserRound /.test(button)
  );
}

describe("the nav's profile button carries no photo", () => {
  it("holds", () => {
    expect(light(nav)).toBe(true);
  });
  it("has teeth", () => {
    expect(light(nav.replace("const { handle } = useEntitlements();", "const { handle, avatarUrl } = useEntitlements();"))).toBe(false);
    expect(light(nav.replace("<CircleUserRound ", '<img src={x} alt="" /><CircleUserRound '))).toBe(false);
  });
});
