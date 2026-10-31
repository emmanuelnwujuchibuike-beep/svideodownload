import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/*
  Owner, 2026-10-31: "the pwa white shows before any logo appears". iOS uses an apple-touch-startup-image only when the
  page it was installed from carries <meta name="apple-mobile-web-app-capable" content="yes">. Next 15 renders
  `appleWebApp.capable` as `mobile-web-app-capable` only, so production had none and every launch began on white.
*/
const layout = readFileSync("app/layout.tsx", "utf8");

const declaresIt = (src: string) => /["']apple-mobile-web-app-capable["']\s*:\s*["']yes["']/.test(src);

describe("the iOS launch image can be used", () => {
  it("the root layout declares apple-mobile-web-app-capable itself (not only through appleWebApp)", () => {
    expect(declaresIt(layout)).toBe(true);
    // and the launch images it unlocks are still declared
    expect(layout).toMatch(/apple-touch-startup-image/);
  });
  /*
    2026-10-31 (owner: "white on every entry before the brand logo, before today it wasn't like this"): launch.html showed
    its logo only through @media (display-mode:standalone), which the installed iOS app often does not match. Once the
    page started waiting for the app stylesheet, that blank page was a long white screen. iOS's own signal reveals it.
  */
  it("launch.html reveals its logo from navigator.standalone, in <head>, before the first paint", () => {
    const launch = readFileSync("public/launch.html", "utf8");
    const head = launch.slice(0, launch.indexOf("</head>"));
    // the SCRIPT line itself (not a comment that mentions it)
    const reveals = (h: string) => /if\(navigator\.standalone\|\|matchMedia[^<]*fx-on/.test(h) && /\.fx-on \.fx\{display:flex\}/.test(h);
    expect(reveals(head)).toBe(true);
    // teeth: the media query alone (what shipped) fails
    expect(reveals(head.replace("if(navigator.standalone||", "if("))).toBe(false);
  });
  /*
    2026-10-31 (owner's screen recording: the launch screen "shows a writing … like news paper"): a CSS comment in
    launch.html contained the text `</style>`, which ENDS the style element even inside a comment — the rest of the
    stylesheet and its comments were drawn on screen as text. One closing tag per element, at the very end.
  */
  it("launch.html closes its <style> exactly once, after every rule — no closing tag hiding in a comment", () => {
    const launch = readFileSync("public/launch.html", "utf8");
    const ok = (h: string) => {
      const closes = h.match(/<\/style/gi) ?? [];
      const end = h.indexOf("</style>");
      return closes.length === 1 && end > h.indexOf(".fx__slow.on{") && end < h.indexOf("</head>");
    };
    expect(ok(launch)).toBe(true);
    // teeth: the comment that shipped breaks it
    expect(ok(launch.replace("the inline script right after this style block", "the script just below </style>"))).toBe(false);
  });
  it("teeth: relying on appleWebApp.capable alone fails", () => {
    expect(declaresIt(layout.replace(/\s*["']apple-mobile-web-app-capable["']\s*:\s*["']yes["'],?/, ""))).toBe(false);
  });
});
