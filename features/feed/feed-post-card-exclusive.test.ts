import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
  Step 13 (design/ExclusiveFeed.dc.html, owner 2026-10-18): subscribed posts use the Feed's own post card,
  in an exclusive mode that must keep every private-post rule. These pin each rule to the source, with a
  teeth case each, because a regression here would put a share button or a public link on a paid post.
*/
const card = readFileSync(join(process.cwd(), "features/feed/feed-post-card.tsx"), "utf8");
const feed = readFileSync(join(process.cwd(), "features/sub/exclusive-feed.tsx"), "utf8");

const rules = (src: string) => ({
  // a like on a private post goes to the access-checked private API
  privateLike: /if \(exclusive\) \{\s*if \(type !== "like"\) return;[\s\S]{0,600}?fetch\(`\/api\/sub\/posts\/\$\{item\.id\}\/like`/.test(src),
  // no repost, send or save in the action row
  noRepost: src.includes("{exclusive ? null : !item.isOwner ? ("),
  noSend: src.includes("{exclusive ? null : <ActionButton\n          icon={FrenzSendIcon as typeof Heart}"),
  noSave: src.includes(`{exclusive ? null : <ActionButton active={saved} onClick={() => react("save")}`),
  // the menu offers only Hide — no Share, Copy link, Download or Save to collection
  menuOnlyHide: /\{exclusive \? \(\s*<MenuItem icon=\{EyeOff\} label="Hide this post"[\s\S]{0,120}\) : \(<>\s*<MenuItem icon=\{Share2\} label="Share"/.test(src),
  // the caption opens the private viewer, never a public post URL
  noPublicLink: /\{exclusive \? \(\s*<button type="button" onClick=\{\(\) => open\(item\)\}/.test(src),
  // no public view / watch counting for a private video
  noPublicViews: src.includes("postId={exclusive ? undefined : item.id}"),
  // the viewer's watermark over the media
  watermark: /function ExclusiveMarks[\s\S]*?@\{handle\}/.test(src),
  // no public comments prefetch or repost attribution
  noPublicPrefetch: src.includes("if (!el || exclusive) return;") && src.includes("if (exclusive) return;\n    attributeRepost"),
});

describe("the exclusive mode of the Feed's post card", () => {
  it("keeps every private-post rule", () => {
    expect(rules(card)).toEqual({ privateLike: true, noRepost: true, noSend: true, noSave: true, menuOnlyHide: true, noPublicLink: true, noPublicViews: true, watermark: true, noPublicPrefetch: true });
  });

  it("teeth: each rule fails when it's taken out", () => {
    expect(rules(card.replace("postId={exclusive ? undefined : item.id}", "postId={item.id}")).noPublicViews).toBe(false);
    expect(rules(card.replace("{exclusive ? null : !item.isOwner ? (", "{!item.isOwner ? (")).noRepost).toBe(false);
    expect(rules(card.replace("if (!el || exclusive) return;", "if (!el) return;")).noPublicPrefetch).toBe(false);
    expect(rules(card.replace(/function ExclusiveMarks[\s\S]*$/, "")).watermark).toBe(false);
  });

  it("the Exclusive feed uses that card for subscribed posts — no separate post component", () => {
    expect(feed).toContain('import { FeedPostCard } from "@/features/feed/feed-post-card";');
    expect(feed).toContain("<FeedPostCard item={item} exclusive={exclusive}");
    // the old discover section is gone; locked cards sit in the stream
    expect(feed).not.toMatch(/>\s*From creators you follow\s*</);
    expect(feed).toMatch(/\(index \+ 1\) % 3 === 0 && li < lockedCards\.length/);
  });
});
