import { describe, expect, it } from "vitest";

import { isOwnPoster, needsRehost } from "./poster-host";

const HOSTS = {
  r2PublicBase: "https://media.frenzsave.com",
  supabaseHost: "wmimmsrtafazowjperog.supabase.co",
};

describe("poster-host", () => {
  it("treats our R2 media domain as ours", () => {
    expect(isOwnPoster("https://media.frenzsave.com/uid/posts/abc-poster.jpg", HOSTS)).toBe(true);
    expect(needsRehost("https://media.frenzsave.com/uid/posts/abc-poster.jpg", HOSTS)).toBe(false);
  });

  it("treats Supabase storage as ours (the no-R2 fallback backend)", () => {
    const url = "https://wmimmsrtafazowjperog.supabase.co/storage/v1/object/public/post-media/x.jpg";
    expect(isOwnPoster(url, HOSTS)).toBe(true);
    expect(needsRehost(url, HOSTS)).toBe(false);
  });

  // The real bug: these are SIGNED urls. They work today and 403 forever once the
  // signature lapses, so they must be copied to our storage while still valid.
  it.each([
    "https://p16-common-sign.tiktokcdn-us.com/tos-no1a-p-0037-no/oQrv46JkQEg0~tplv.jpeg",
    "https://p19-common-sign.tiktokcdn-us.com/tos-useast5-p-0068-tx/oEGkmLCjk~tplv.jpeg",
    "https://scontent-sjc6-1.xx.fbcdn.net/v/t51.2885-15/123_n.jpg",
  ])("flags an expiring foreign CDN poster for re-hosting: %s", (url) => {
    expect(isOwnPoster(url, HOSTS)).toBe(false);
    expect(needsRehost(url, HOSTS)).toBe(true);
  });

  it("does not re-host when there is no poster (nothing to copy)", () => {
    expect(needsRehost(null, HOSTS)).toBe(false);
    expect(needsRehost(undefined, HOSTS)).toBe(false);
    expect(needsRehost("", HOSTS)).toBe(false);
  });

  it("is not fooled by our host appearing elsewhere in the URL", () => {
    // A foreign CDN echoing our domain in a query param is still foreign.
    const url = "https://evil.example.com/proxy?src=https://media.frenzsave.com/a.jpg";
    expect(isOwnPoster(url, HOSTS)).toBe(false);
    expect(needsRehost(url, HOSTS)).toBe(true);
  });

  it("re-hosts everything when no storage hosts are configured, rather than guessing", () => {
    expect(needsRehost("https://p16-common-sign.tiktokcdn-us.com/x.jpg", {})).toBe(true);
  });

  it("does not throw on a malformed URL", () => {
    expect(() => needsRehost("not a url", HOSTS)).not.toThrow();
    expect(needsRehost("not a url", HOSTS)).toBe(true);
  });
});
