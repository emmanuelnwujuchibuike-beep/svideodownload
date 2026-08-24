import { describe, expect, it } from "vitest";

import {
  CREATOR_NOTIFICATION_CHANNELS,
  CREATOR_NOTIFICATION_LABELS,
  DEFAULT_CREATOR_NOTIFICATION_PREFS,
} from "./creator-notification-channels";

/**
 * The defaults are the whole safety story for this feature (owner, 2026-08-23:
 * "turn on and off another users post notification, stories notification, feed
 * or share notification"). They decide what happens for the overwhelming
 * majority of (viewer, creator) pairs, which have no row at all, so getting one
 * wrong silently changes behaviour for everyone rather than for a few people
 * who opted in.
 */
describe("creator notification defaults", () => {
  it("🔴 posts/stories/feed are OPT-IN", () => {
    // Notifying every follower about every post from everyone they follow is
    // how a bell becomes something people permanently silence. False here also
    // means shipping this feature changes nothing until someone asks for it.
    expect(DEFAULT_CREATOR_NOTIFICATION_PREFS.posts).toBe(false);
    expect(DEFAULT_CREATOR_NOTIFICATION_PREFS.stories).toBe(false);
    expect(DEFAULT_CREATOR_NOTIFICATION_PREFS.feed).toBe(false);
  });

  it("🔴 shares defaults ON, because that notification already fires", () => {
    // The `share` type ("Shared your post") is live today. Defaulting this off
    // would silently STOP a notification people already receive — a behaviour
    // change disguised as a new feature. The capability added here is the
    // ability to turn it off for one specific person.
    expect(DEFAULT_CREATOR_NOTIFICATION_PREFS.shares).toBe(true);
  });

  it("every declared channel has a default and a label", () => {
    // A channel with no default resolves to `undefined`, which is falsy — so a
    // missing entry would silently disable a notification rather than fail.
    for (const channel of CREATOR_NOTIFICATION_CHANNELS) {
      expect(typeof DEFAULT_CREATOR_NOTIFICATION_PREFS[channel]).toBe("boolean");
      expect(CREATOR_NOTIFICATION_LABELS[channel]?.label).toBeTruthy();
      expect(CREATOR_NOTIFICATION_LABELS[channel]?.hint).toBeTruthy();
    }
  });

  it("declares exactly the four channels the owner named", () => {
    expect([...CREATOR_NOTIFICATION_CHANNELS]).toEqual(["posts", "stories", "feed", "shares"]);
  });
});
