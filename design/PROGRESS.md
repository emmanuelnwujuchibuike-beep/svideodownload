# Design rebuild — progress

One page at a time, in order. Each step is committed locally on the `ui-redesign`
branch (never pushed, no PR until the owner says "push") and stops for the owner's
review before the next one starts.

- [x] 0. Foundation (tokens, fonts, BottomNav, VerifiedBadge, Avatar, IconButton, SectionHeader, Card, Input, SegmentedControl) — frenz-* tokens + Sora/Hanken fonts, shared primitives in features/frenz-ui, the existing bottom nav restyled to the design with a white fade.
- [x] 1. Home / Download → design/Main.dc.html — existing H1 in Bricolage, the paste card on the real download flow, Batch download, live transfers, Tools (Frenz AI, Wallpapers, Earn, Exclusive, Explore) where Recent was, Cloud storage; lighter page.
- [x] 2. Feed → design/Feed.dc.html — tab row (For You · Following · Reels · Exclusive) above the stories, 64 px story rings, the stacked post card, full-width media capped to one screen.
- [x] 3. Messages → design/Messages.dc.html — Sora header with Add friends / More / gradient New message, stories above the fill search, pill filters with real counts, edge-to-edge rows.
- [x] 4. Chat → design/Chat.dc.html — design header, one time per message group (tested rule), 20 px bubbles with the tail on a group's last, day pill, round attach + fill pill + gradient mic/send.
- [x] 5. Profile → design/Profile.dc.html (updated: Private → Exclusive) — one shared hero (cover, overlapping avatar, Sora name, stats card, ink Edit/Follow + Share), underlined tabs with Exclusive, edge-to-edge 3:4 grid.
- [x] 6. History → design/History.dc.html (owner's screenshot) — large title with real count · size (opens storage), one options button, Select, fill search, segmented filter, edge-to-edge day groups, icon + source tiles with long-press sheet, infinite scroll, lightbulb → options menu.
- [ ] 7. Landing page → the same system: white page, iOS glass chrome, no Recent section
- [ ] 8. Wallpapers → design/Wallpapers.dc.html
- [ ] 9. Profile menu → design/Menu.dc.html
- [ ] 10. Settings → design/Settings.dc.html
- [x] 11. Profile Exclusive tab (owner view) → design/ProfileExclusive.dc.html (moved forward at the owner's request) — one dashboard card with real figures, Share link / Dashboard, rows for announcements and notifications, Subs-tagged grid with Manage, hub as three iOS lists with Add.
- [ ] 12. Exclusive page (subscriber view) → design/Exclusive.dc.html
- [ ] 13. Exclusive feed tab → design/ExclusiveFeed.dc.html

No page had been approved when the white-background rules arrived (2026-10-18), so
they are applied while each page is built and there is no separate cleanup step.

## Owner rules added during the work (2026-10-18)

- Use the design's fonts: Sora (headings) and Hanken Grotesk (body).
- Keep the app's existing brand logo; never use the logo drawn in the design.
- Home / landing: no Recent section (it belongs in History). That space shows the
  Earn, Frenz AI and Exclusive features in the same design system.
- Keep the My ads button in the top header.
- Every page background is white. Cards are white with a 1px #ECE9F7 border and at
  most a very soft shadow. Inputs, search bars and segmented controls use #F1F0F6.
- Home hero: the existing H1 "Save. Discover. Create and earn." and its description,
  in a more unique, premium face (Bricolage Grotesque, one static weight).
- Everything lightweight: no new libraries, one static font weight for the hero,
  below-the-fold pieces code-split, sections the design drops come off the page.
- iOS glass, lightweight: on the CHROME only (top header, bottom nav, sticky
  search/tab bars, sheets), through the existing `frenz-nav-glass` tiers (blur
  drops on low-power devices / reduced motion, solid for reduced transparency).
  Page grounds and cards stay white.
- The brand gradient only on: primary actions (Download, new message, chat
  mic/send), active indicators, identity (logo, avatar/story rings, nav profile
  button), small badges (PRO, counts), and the AI Studio / Wallpapers showcase
  cards. Never on backgrounds, rows, plain cards, secondary/icon buttons, text,
  dividers, borders, washes or glows.

## Required with the Exclusive steps (11–13) — owner, 2026-10-18
- Non-subscribers must never receive the original media of a locked post: the
  server makes a heavily blurred, low-resolution preview and sends only that; the
  original is served only after an active-subscription check. Every place a locked
  post renders (profile Exclusive tab, Exclusive page, Exclusive feed, the top of
  the current exclusive feed, anywhere else) must use the preview.
- If explicit content can be posted as exclusive content: age verification and
  content gating are needed before launch, and sexually explicit content is not
  allowed in App Store apps. Age verification is NOT to be built without asking.
- Glass (blur + translucent fill) only over images; solid white cards on white.

## Notes — where the design and the app differ

### Step 0 · Foundation
- Colours live in `lib/platform/design-tokens.ts` (`FRENZ_TOKENS`, generated into
  globals.css) and Tailwind `frenz-*` (blue, violet, magenta, ink, muted, page, card,
  line, fill), plus `bg-frenz-gradient` / `bg-frenz-gradient-x`. Dark mode reuses the
  app's existing dark values, so no new colours were added for it.
- The design's in-between shades (#3D2BB8 active text, #EEEBFD capsule, #4A4760
  inactive, #E6E2F5 border, #8A879C placeholder) are not tokens: they map to
  `frenz-violet`, `frenz-violet/10`, `frenz-ink/80`, `frenz-line`, `frenz-muted`.
  #3D2BB8 became `frenz-violet` (4.95:1 on the capsule); `frenz-blue` was 4.44:1 there.
- The online dot uses Tailwind's existing `emerald-500` (the design's #2FB36B is not a
  token). Success/failure chips will use the existing emerald/rose shades for the
  same reason.
- Shadows are neutral ink only. The design's violet glows under the Download button
  and the nav profile button were dropped (owner: no glows).
- Fonts load with `preload: false`, so only text inside `.frenz-ui` fetches them and
  the landing's first load is unchanged. The swap is size-matched by next/font.
- BottomNav is the existing `MobileNav`, restyled rather than rebuilt: all of its
  warm-up, unread badge, pending stripe, scroll-away and Reels behaviour stays. Bar
  height 60 → 68 px (`--frenz-nav-height` 4.25rem), so every page's reserved
  clearance grows with it; the Reels scrubber still clears it (test updated).
- The white fade behind the nav is new and full-width. The 2026-10-09 nav rule said
  "no full-width backing behind it"; the owner's 2026-10-18 instruction asks for the
  fade, so it ships, hidden on Reels and whenever the nav slides away.
- Guests keep Friends in place of Feed (the design shows only the member set).


### Step 1 · Home / Download (/downloads)
- Header: the app's top bar stays (logo, Install, **My ads**, bell) — owner: keep My ads
  there. The design's "Download" title is replaced by the existing H1 "Save. Discover.
  Create and earn." and its line (owner), in Bricolage Grotesque 800. "Discover." is
  flat violet, not gradient text (gradient is not allowed on text).
- Paste card: the existing DownloadBox flow (paste, validate, fetch, preview card,
  format choice, quota gate, auto-download) with a new `frenz` look. The button says
  "Download" (was "Save"). "+7 more" is the real count and opens the full tappable
  platform grid with each platform's status (the design said "+4 more").
- Batch download: the existing Multi-Link card and panel; the subtitle shows this
  visitor's real limit (3 free / 6 Pro) with the PRO badge.
- No Recent section here or on the landing (owner) — it lives in History. In its place
  a "Downloading" list appears only while transfers are in flight: progress, pause /
  resume, failed + Retry + report, cancel. A finished save leaves it for History.
- Tools: Frenz AI (keeps the admin promotion media) and Wallpapers (the 10 rotating
  photos) are the two gradient showcase cards; Earn, Exclusive (owner) and Explore are
  white cards. Copy is the app's existing wording; the design's "AI Studio · Restyle
  any photo" and "NEW" badge were not used. Icon tiles are flat violet, not gradient.
- Cloud storage: real bytes against the plan's ceiling; tap opens the existing usage
  detail (breakdown, upgrade-or-clear) inline, loaded only then.
- Lighter: removed from /downloads — stat tiles, quick actions, the side rail, the trust
  strip, the in-page wallpaper gallery (and its 600-row read per visit; now 10 rows),
  the per-visit landing-settings read. Kept: the three ad zones, Tired of ads, the
  download interstitial, exit intent, the trademark disclaimer.
- Not matched: the design's "Open in Photos" check and the "saved" row state — finished
  downloads belong to History now (owner).

### Step 2 · Feed (/home)
- Header: the app's top bar (logo, create, search, bell) — the design's gradient "F"
  square is not used (owner: keep the existing logo).
- Tabs: their own underlined row under the top bar, ABOVE the stories (portalled from
  SmartFeed into a slot on /home): For You · Following · Reels · Exclusive with a lock
  (owner: Exclusive in the top row). Exclusive opens the existing /exclusive feed until
  step 13 builds the in-feed tab. Framer-motion dropped from the tabs.
- Stories: 64 px rings, gradient when unseen, hairline when seen; the add button is the
  dashed "Your story" ring until you have one, then "Add story" (your own ring carries
  "Your story" — two rings with one name would be ambiguous).
- Post card: the design's stacked card — avatar, name, seal, date, then "Following" (a
  status, not a button: unfollow stays in the ⋯ menu) or a "Follow" button; the Frenz
  F-mark stays on each post (owner, 2026-08-17); caption; media edge to edge; action
  row (Wow — the app's like — comment, repost, send … save) on 44 px targets.
- Media frame (owner, 2026-10-18): every video and photo fills the card width; height is
  the smaller of its natural height and the screen less ~25rem, so a 9:16 clip is shown
  whole with the creator row, caption, actions and the next post's header on one screen.
  Sides fill with the existing blurred backdrop. Video views show as a glass chip on the
  video (glass over imagery only); photos keep the count under the media.
- Gradients removed from content: Discover cards, "While you were away", the "new posts"
  pill and "Explore everything" are white cards or flat violet now.
- Not matched: the design's heart + "1" like — the app's like is the Wow reaction with
  its picker; kept, coloured magenta when active.

### Step 3 · Messages (/messages)
- Header: "Messages" in Sora 30 px (23–26 px under 390 px so it fits 320 px), then three
  44 px circles: Add friends (opens the existing /friends flow, go-once link), More (the
  existing tools menu: search, presence, notifications, Secret Chats) and New message —
  the one gradient circle (compose is a primary action). The avatar menu left the row;
  the bottom nav's profile button opens the same profile. The "Stay connected…" line is
  not in the design and is gone.
- Stories stay above the search field (owner, 2026-10-18), compact rings — not in the
  design, kept on the owner's word.
- Search: the #F1F0F6 field, "Search people and messages", 16 px text; the archived
  toggle stays inside it.
- Filters: the design's pills (ink when chosen). All and Unread show real counts again
  (the 2026-10-09 rule hid the Unread count; the newer design shows it), Requests its real
  count, Channels keeps its "coming soon" state.
- List: edge to edge (owner: "Chats should reach the extreme edges") — white rows divided
  by the hairline, no card. Plain 50 px avatars (the gradient ring on every row is gone),
  the green online dot from the real presence set, the design seal, gradient unread badge
  (a small badge — allowed). Swipe actions, menus, typing, streaks and pins unchanged.
- Removed: the inbox page's decorative blue corner glow (owner: no washes).
- Not matched: the design's "OFFICIAL" tag — the app has no official-account flag; not
  invented.
- The uncommitted typing fix (0259/0260) also edits conversation-list.tsx: only the
  redesign hunks were committed; the typing fix stays unstaged for the owner's review.

### Step 4 · Chat (/messages/[id])
- Header: back chevron (44 px), 42 px avatar with the online dot, the name in Sora with the
  design seal, the existing presence line, the options circle. No voice / video call
  buttons: calls are not built, and the owner removed them on 2026-10-07 ("I don't want a
  coming soon"). The decorative corner glow is gone; the blurred white header stays.
- Grouping (owner brief): consecutive messages from one sender, the same day, each within
  5 minutes, are one group (lib/social/message-groups.ts, tested). One time per group —
  with "· Seen / Delivered / Sent" and the ticks on your newest message — sits under the
  group's last bubble; only that bubble has the tail; 4 px inside a group, 8 px between.
  This replaces the per-bubble time from 2026-09-13; "edited" stays on its own bubble.
- Bubbles: the default "classic" style is now the design's 20 px corners with a 6 px tail.
  Yours default to the flat brand blue (the design's gradient bubble is not allowed on
  content); theirs white with the hairline. Chat themes, wallpapers, bubble colours and
  the other bubble styles people choose are unchanged.
- Day divider: the design's soft pill.
- Composer: round attach (+), the pill on the input fill with emoji and camera, 16 px text
  (no iOS zoom), and one gradient circle that is the mic when empty and Send once there is
  text or an attachment (that swap already existed and still works).
- Not matched: the design's "Message" placeholder — kept the owner's literal "Send a chat"
  (2026-08-16); the design's "Read" — the app's word is "Seen".

### Step 5 · Profile (/:handle) — the updated design (Private → Exclusive)
- One shared hero for the owner and visitors (features/profile/profile-hero.tsx): the cover
  under the status bar with a soft foot scrim, the avatar overlapping it on the left, the
  name in Sora 30 px with the seal, "@handle · TYPE", bio, website, joined date, the white
  stats card (Followers / Following open their lists), then the actions — on the white
  page (the .frenz-lux page tint and the glass identity card are gone).
- Owner: the design's white "N-day streak" pill beside the avatar (the amber gradient chip
  is not allowed); Edit profile (solid ink) + Share profile (white) + the existing profile
  card (QR); the camera button opens Identity. Search / Edit cover / Menu stay as glass
  circles over the cover (glass over an image), 44 px, the menu with the design's ⋯.
- Visitor: Follow (solid ink, white once following — the gradient Follow is gone) and
  Message side by side, then share and the profile card; relationship chips, Book / Quote /
  Call, Add friend, alerts and block/report keep their row; the private-account notice
  is a white card.
- Kept, not in the design: the avatar's identity frame (gold for a paid plan, else the
  member's accent — owner, 2026-09-13) and its Photo / Video / Avatar media; the plan jewel,
  headline, mood / status and the public reputation rank (a small badge).
- Not kept: the Photo / Video / Avatar switcher pill under the avatar — the mode is changed
  in Identity, one tap away on the camera button.
- Tabs: the design's labelled row with the gradient underline and one grid / list button;
  "PRIVATE POSTS" is now "Exclusive" with its lock (updated design) and still preloads its
  posts on touch. The separate EXCLUSIVE feed link (2026-10-17) left the tray — the Feed's
  own Exclusive tab is that door now. Which tabs appear is still the profile engine's choice.
- Grid: edge to edge on phones, 3:4 tiles, 2 px apart, square corners.

### Step 6 · History (/history) — built from the owner's screenshot (no .dc.html yet)
- Header: "History" in Sora 38 px; under it "☁ N items · size ›" with the real count and
  size, which opens the existing storage detail (breakdown, upgrade-or-clear) in place.
  Right: ONE options button and the Select pill (Done while selecting).
- The options button holds Sort (Recent / Alphabetical / Largest / Top platform), Grid /
  List, the column count (3 by default, as drawn; a saved choice still wins), Favorites and
  Failed & cancelled (their chips left the row), Frenz AI, and Clear all (now behind a real
  confirm). A chosen Favorites / Failed filter shows as a pill that clears it in one tap.
- The floating lightbulb button went (owner): it opened Frenz AI, which is now the "Frenz AI"
  entry in the options menu. Nothing else it did was lost.
- Search: the native field on the input fill. Then the All · Videos · Images · Audio
  segmented control (radio semantics, arrow keys).
- Grid: edge to edge, 3 columns, 2 px apart, grouped by day (Today, Yesterday, This week,
  Last week, Earlier) with "N items" and the existing collapse. Each tile shows only the type
  icon and the source name; Failed / Cancelled + Retry stay on the tile (a state you must
  see). The caption, favourite, download again, copy link, publish as sound and remove are
  on a long press, the caption at the top of that menu.
- Infinite scroll: ungrouped views (another sort, list view) load the next page as the end
  comes near instead of "Show more". The day-grouped view already renders everything, each
  section skipped by the browser until near (content-visibility), as before.
- Found, not caused here: /history logs a React hydration mismatch and a 500 from one request in dev, on the committed code before this step too (checked with these changes set aside). Worth a look on its own.
- Select mode, its Share / Download again / Delete bar, the ad slots between periods and
  above the grid, the player queue with story ads, review deep links and the reward gate
  for retries are unchanged.

### Step 11 · Profile Exclusive tab, owner view (ProfileExclusive.dc.html) — moved forward
- One dashboard card: "Your subscription", the real monthly price in Sora 30 px with LIVE
  (green) or PAUSED (amber); three real figures — Subscribers, Last 30 days, Posts — read
  once from the creator's own earnings overview when the tab opens ("—" until in, never a
  guess). The design's "This month" is "Last 30 days": the data is a rolling 30 days.
- "New exclusive post" is the gradient primary (it opens the existing composer). "Share link"
  is the old "Your Content. Your Earnings." banner's share (that banner is gone). "Dashboard"
  opens the existing panel: balance + Withdraw, metrics, earnings link, change price, pause /
  resume, payout account.
- Announcements and Subscriber notifications are rows on the card (were two dropdowns); each
  opens the same, already-mounted panel under the card.
- Exclusive posts: "Exclusive posts N · Manage" over the grid (Manage opens Members, where
  the paid subscribers are managed); tiles edge to edge, 3:4, with the design's "Subs" lock
  tag (Hidden posts keep "Hidden"); the decorative gradient placeholder is a flat fill.
- More on this profile: three iOS lists — Showcase (About, Products, Services, Hours &
  location, Top friends, Life journey + the other showcase sections), Insights (Analytics,
  Achievements, Daily streak, Reputation, Profile health, Recent activity), Only you (Creator
  tools, Private journal, Time capsules). Empty sections show "Add" (it opens the section)
  instead of "Nothing here yet". Appearance is not listed (it belongs to Settings, step 10).
  Visitors see the same lists without the owner-only subtitles.
- Not built here: the design's compact sticky header (small avatar, name, share) — the
  profile hero above the tabs already carries these; the visitor's subscribe view is step 12.

### Outside the page steps (owner, 2026-10-18)
- `a50b9cd`: full-screen ads lost the engagement tray (brand badge, Like, views,
  Share) and its per-ad fetch; the advertiser dashboard lost Likes. Shares stays on
  the dashboard as the lifetime count, but nothing new can be shared now that the
  button is gone — say if Shares should go too.
- 2026-10-18: the first two commits (`ac4b834`, `a50b9cd`) were made on local `main`
  before the branch was named; they were moved to `ui-redesign` and local `main`
  points back at `3739e7c`. `origin/main` is 9 commits ahead and was not pulled.
