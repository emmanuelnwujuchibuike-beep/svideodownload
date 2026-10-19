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
- [x] 7. Landing page → the same system: white page, iOS glass chrome, no Recent section
- [x] 8. Wallpapers → design/Wallpapers.dc.html
- [x] 9. Profile menu → design/Menu.dc.html
- [x] 10. Settings → design/Settings.dc.html
- [x] 11. Profile Exclusive tab (owner view) → design/ProfileExclusive.dc.html (moved forward at the owner's request) — one dashboard card with real figures, Share link / Dashboard, rows for announcements and notifications, Subs-tagged grid with Manage, hub as three iOS lists with Add.
- [x] 12. Exclusive page (subscriber view) → design/Exclusive.dc.html
- [x] 13. Exclusive feed tab → design/ExclusiveFeed.dc.html
- [x] 14. Chat options → design/ChatMenu.dc.html (added by the owner 2026-10-18) — with new-message email and its switch

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
  → DONE 2026-10-18 (0263, lib/sub/blur-preview.ts). Audit of every locked-post surface: before this,
    a non-subscriber already received NO private file anywhere (no key, no signed link, no caption —
    asserted in lib/sub/security-boundaries and age-gate tests); what they saw was the creator's own
    public cover, or a plain tile. Now each post carries a 20 px, heavily blurred WebP made on the server
    from its first item (a video from its first-frame thumb) and stored as a data URL of a few hundred
    bytes — the detail is gone before it is stored, so it is safe to send and costs no extra request.
    It is what a non-subscriber's tile shows in the profile Exclusive tab / Exclusive page (sub-gallery)
    and on the Exclusive feed's discover cards (the creator's public cover still wins where they set one).
    A subscriber and the creator get the real signed thumbs instead. A Mature post's preview goes only to
    a confirmed adult. New posts get theirs right after publishing (after()); older posts when their
    creator next opens the gallery, a few at a time — nothing on a timer. 0263 is NOT applied until the
    branch reaches main. Tests: lib/sub/blur-preview.server.test.ts (real sharp; the routes).
- If explicit content can be posted as exclusive content: age verification and
  content gating are needed before launch, and sexually explicit content is not
  allowed in App Store apps. Age verification is NOT to be built without asking.
  → Asked and answered 2026-10-18: date of birth + an 18+ confirmation, protecting posts
    marked Mature (18+); sexually explicit content stays banned. Built — see "Age checks" below.
- Glass (blur + translucent fill) only over images; solid white cards on white.

## Owner page notes for steps 8–13 (verbatim, 2026-10-18)

\n\nWallpapers\n- Featured wallpaper as a full-bleed header with glass buttons (Back, Search + Upload) and glass category chips over it; a white sheet slides up over it with "All wallpapers", count and sort.\n- 3-column tiles with a frosted name plate (name, @creator, 2K) and a glass download button.\n- The Categories and Types dropdowns move into the single filter button. Upload lives in the header.\n- Glass (blur + translucent fill) is ONLY allowed over images. On white surfaces use solid white cards.\n\nProfile menu\n- Bottom sheet over the current screen, with grab handle and close button.\n- Profile card → profile. Shortcuts grid: Explore, Reels, Sounds, Friends, Downloads, Saved, Wallpapers, AI Studio. "More" group: My ads, Settings, Help & support. Footer: Light/Dark/Auto switch and sign out.\n- Remove Home and Chats from this menu (they're in the tab bar). Wire every item to our existing routes.\n\nSettings\n- "‹ Menu" back link, large "Settings" title, search field, compact profile row.\n- Quick settings tiles with working switches for Dark mode, Ghost mode, Pause alerts, plus Language. Replace pin/unpin with one "Edit" link that uses our existing pinning logic.\n- Grouped lists: Profile (Identity, Verification, Appearance) and Account (Notifications, Privacy & security, Storage & downloads, Language), showing current values on the right. Sign out and version at the bottom.\n\nProfile Exclusive tab (owner view)\n- One dashboard card: price per month with LIVE status, stats (Subscribers, This month, Posts) from our real data, "New exclusive post" primary button, "Share link" and "Dashboard" buttons, and rows for Announcements and Subscriber notifications (replacing the two dropdowns).\n- Remove the "Your Content. Your Earnings." banner; its share action is now the "Share link" button.\n- Exclusive posts grid with a "Subs" lock tag and Manage link.\n- Group the profile buttons into 3 iOS lists:\n  - Showcase: About, Products, Services, Hours & location, Top friends, Life journey\n  - Insights: Analytics, Achievements, Daily streak, Reputation, Profile health, Recent activity\n  - Only you: Creator tools, Private journal, Time capsules\n  Empty items show an "Add" button instead of "Nothing here yet". Remove Appearance here (it's in Settings).\n\nExclusive page (subscriber view)\n- Cover, avatar, name, then a subscribe card with what's included and a "Subscribe · [price]" button using our existing payment flow. Use each creator's real price and billing period.\n- Replace "[Renewal & cancellation terms]" with our real billing terms; if we don't have them written, flag it in PROGRESS.md instead of inventing them.\n- Locked posts show as heavily blurred tiles with a lock icon, plus a "See everything" tile that opens subscribe.\n\nExclusive feed tab\n- Add "Exclusive" (with a lock icon) as a 4th tab in the Feed, next to For You, Following and Reels. Remove the current "From creators you follow" section and replace it with this tab.\n- Top row: "Your subscriptions" avatars with gradient rings and a small new-post count, a "Manage" link, and a "Discover" button.\n- Posts from creators the viewer IS subscribed to render exactly like normal feed posts (same component), with a "Subscribed" tag on the creator and an "Exclusive" tag on the media. They play normally.\n- Posts from creators the viewer is NOT subscribed to render as a locked card: creator header with "View profile", a blurred preview with a lock, "Subscribers only · [type] · [n] of [total] posts", and a bottom bar with the creator's real price and period (e.g. "$5.50 for 30 days of access") and a Subscribe button using our existing payment flow.\n- Reuse the existing feed post component; don't build a separate one.\n\n

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
- Found, not caused here: /history logged a React hydration mismatch and a 500 in dev. FIXED 2026-10-18:
  · the mismatch: useUser seeded its first render from module state, so a header inside a page's
    loading boundary hydrated as "signed out" while the server HTML said "loading" — React threw the
    page's HTML away. useUser now renders the server's answer for the hydration pass (the same fix
    useEntitlements got on 2026-10-14). Guarded in features/history/history-entry.test.ts.
  · the 500: /icon.png existed as both public/icon.png and app/icon.png. Production already served
    app/icon.png (163 kB, checked on frenzsave.com), so public/icon.png was never reachable; it is
    renamed public/icon-legacy-shadowed.png (deleting it was blocked — the owner can delete it).
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

### Step 7 · Landing (/) — the same system, nothing removed
- The landing's hero is the Home design (DownloadPageCore `frenz` mode, turned on by
  components/landing/hero.tsx): the H1 in Bricolage, the paste card on the real download
  flow, Batch download, live transfers, Tools (Frenz AI with its promo media, Wallpapers,
  Earn, Exclusive, Explore), Cloud storage.
- Kept exactly as before (owner, 2026-10-18: "don't remove …"): Install and My ads in the
  top bar; the landing's install-banner choice (still off, as decided 2026-08-25); no trust
  pills (removed 2026-10-08, the owner chose to keep it that way); the rotating multi-format
  ad slot; the under-download zone; the stat tiles once there are downloads; the disclaimer.
- One layout: the landing is DownloadPageCore's only caller, so its old layout (DownloadsHero, the
  Frenz AI / Wallpaper tiles, the credits strip, More to Explore, the Cloud storage card) was removed
  rather than shipped unused. That took the landing from 221 kB back under its 218 kB ceiling with no
  feature lost. Three tests that pinned the old layout now pin the same rules on the new one.
- Changed: the admin's single "wallpaper CTA image" (landing settings) is no longer drawn — the
  Wallpapers card shows the last 10 uploads rotating, as on /downloads; with fewer than two uploads it
  shows its gradient. The setting still exists in admin.
- No Recent section on the landing (owner). The landing's sections below the hero (Frenz AI,
  Discover, Promote, Features, How it works, CTA, downloader links, FAQ) are not restyled yet.

### Step 8 · Wallpapers (/wallpapers) — Wallpapers.dc.html
- The featured wallpaper is a full-bleed 470 px header: the first in the library's own order (the
  operator's curation), shown from its thumbnail so the page stays light. Glass only over it: Back,
  Search + Upload, the FEATURED badge (with the real resolution, only when measured), "Get this one"
  (the real download, same reward-ad / limit / Pro flow) and "Preview" (the existing full-screen
  viewer — the design says "Preview on lock screen"; we have no lock-screen mock, so it opens the viewer).
- Glass category chips (the real categories, most-used first); Categories and Types moved behind the
  one filter button, into a sheet with the native pickers, Clear and "Show N".
- A white sheet slides over it: grab handle, "All wallpapers", the count and a sort button (a native
  picker; engagement orderings appear only once anything has engagement, as before). 3-column tiles
  with the frosted name plate (name, real resolution badge, credit) and a glass download button
  (44 px target around the 34 px circle). Pro wallpapers keep the gold crown.
- Copy: "505 designs. Free to download." — the design says "from the community", but the library also
  holds curated wallpapers, so that phrase was left out.
- Kept: 30 then "See N more · M left" (now a white secondary button, not the gradient), "See less" top
  and bottom, the upload flow (moved from the floating pill into the header, as drawn), the upload
  status toast, the SEO content, the visible breadcrumb (now a quiet line under the grid) and the footer.
- Changed: the page no longer shows the site header — the design's header is the image. The design also
  draws the bottom tab bar; /wallpapers sits outside the signed-in shell, so it has none (as before).

### Step 9 · Profile menu (Menu.dc.html)
- One panel for every place the menu opens (header avatar sheet, profile page sheet, desktop
  panel): "Menu" + close, a white profile card (avatar with the identity ring, verified tick, plan
  crown, "@handle · View profile"), Shortcuts — Explore, Reels, Sounds, Friends, Downloads, Saved,
  Wallpapers, Frenz AI — then More — My ads, Settings, Help & support — and a footer with
  Light / Dark / Auto and sign out. Home and Chats are gone from the menu (they are in the tab bar).
- The design labels the AI tile "AI Studio"; the product is named Frenz AI (owner, 2026-09-07), so it
  keeps its name. It is the one gradient tile (the AI showcase). The icon is the lightbulb, never a
  sparkle (owner rule).
- Kept beyond the design: Go Premium (free accounts — the menu was its door), and the Language row
  (as before; Settings has it too). Gone: the brand logo row, "My Spaces", the unread count on the old
  Chats row, the build number (Settings shows the version).
- Help & support moved from the footer into More (the 2026-10-09 test now pins the new place).
- Page weight is measured with the step 10 build.

### Step 10 · Settings (/account) — Settings.dc.html
- "‹ Menu" (back to the page the menu was opened over; a fresh tab goes to the profile), the large
  title, the search field, a compact profile row ("@handle · Business account" from the real profile
  type, plan crown, verified tick, Admin tag) and Quick settings.
- Quick settings are the member's existing pins (defaults unchanged: Dark mode, Ghost mode, Pause
  alerts, Language) as tiles with WORKING switches:
  · Dark mode — the same theme store as the menu's Light / Dark / Auto ("Auto · on now" when Auto).
  · Ghost mode — every activity signal at once, through the Ghost Mode screen's own write path
    (useGhostMode, extracted so both screens save the same way, with its honest partial revert).
  · Pause alerts — notifications' master switch (masterEnabled), the field the Notifications screen
    saves; it answers on the tap and goes back if the server refuses.
  · Language — opens the same picker.
  One "Edit" link replaces the per-chip unpin buttons: in edit mode a tile can be removed; search
  results still pin new ones. Any other pinned setting is a tile that opens its screen.
- The two lists: Profile (Identity, Verification — "Verified" on the right, Appearance, plus
  Accessibility, which was in Profile before and is kept) and Account (Notifications — On / Paused,
  Privacy & security — the real security score, Storage & downloads — the plan, Language — the current
  language). Everything else that was on Settings stays, below, in the same list style: Profile
  platform, Privacy, Content & insights, Plan & developer, Admin. Sign out and the version at the end.
- The search suggestion chips stay, shown only while the empty field has focus (the design has none).
- Kept: the app top bar (every signed-in page has it; hiding it would need the page-transition work
  the Messages inbox needed). The cover-photo hero is replaced by the design's compact row.

### Step 12 · Exclusive page, visitor without access (Exclusive.dc.html)
- The cover, avatar and name are the profile hero rebuilt in step 5 (the Exclusive tab sits under it).
- The subscribe card: "Unlock exclusive posts" / "Subscriber-only content from [name]", what's included
  (the app's real three), and "Subscribe · [price for the period]" on the existing checkout, with the
  creator's real price, fee line and period. The design's "[Renewal & cancellation terms]" is our real
  terms, already in the product: "One payment for [N] days. Nothing renews automatically — you renew when
  you choose. Paid securely with Paystack; unlocks once the payment is confirmed." Nothing to flag.
  Renew (an expired subscription), Sign in, "You're subscribed" and "not taking subscriptions" keep their
  cards.
- "Exclusive posts N", then two columns of heavily blurred tiles — the server's blurred preview (0263),
  or the creator's public cover — each with a lock and what it holds (Photo / Video / N items, + 18+),
  and a "See everything" tile; both take the visitor to the subscribe card. No private file, link or
  caption reaches this grid.
- The design's "@chris · Exclusive creator" label isn't added: the hero's own line stays.

### Step 13 · Exclusive feed tab (ExclusiveFeed.dc.html)
- /exclusive carries the Feed's tab row with Exclusive active (For You / Following link back with
  ?tab=, read once by smart-feed; Reels to Reels). The old "Exclusive ★ / Favourites" header is gone;
  Favourites sits beside Manage in the subscriptions row.
- "Your subscriptions": every creator the viewer subscribes to, in identity rings, with how many of their
  posts are new since this device last opened the feed (a real count kept on the device), Manage
  (/account/subscriptions), and a Discover button that jumps to the first locked card.
- Subscribed posts are the Feed's own FeedPostCard (owner: "same component"), in a new exclusive mode
  that keeps every private rule: "Subscribed" on the creator, "Exclusive" on the media, the viewer's
  @handle watermarked over it, likes through the access-checked private API, Comment opens the private
  viewer; no share, copy link, download, save, repost, follow, poll or public view counting, and the
  caption opens the private viewer, never a public URL. They play in place: the server now signs the
  FIRST item's own file for a subscriber's card (15-minute link, per viewer, after the same access
  decision); later items open in the viewer. Like / comment counts are not shown on the card (counting
  per post on every page would be N queries; the viewer shows the real counts).
- Locked cards (creators the viewer follows but doesn't subscribe to) sit after every third post: the
  creator with View profile, the server's blurred preview with a lock, "Subscribers only · [type] · 1 of
  [N] posts" (N = their published locked posts), and "[price] for [N] days of access" + Subscribe on the
  existing checkout. The "From creators you follow" section is gone.
- Tests: features/feed/feed-post-card-exclusive.test.ts (each private rule, with teeth); the feed's
  server tests now pin "one tile link + one first-item link per post, never a later item".

### Step 14 · Chat options (ChatMenu.dc.html) and new-message email
- A white sheet: the person (avatar with the identity ring, name, verified, @handle, "View profile"),
  "Send AI credits" (the existing send sheet), Theme (the app's real themes, default first), Wallpaper
  ("Both of you" / "Only you", upload, the current picture, Remove — the two scopes as before), then one
  list — Disappearing messages (its value; the Off / 24h / 7d / 30d / Custom control opens from the row),
  Font & bubble style, Search messages, Email me new messages — and Block or restrict / Report at the
  foot, with Delete conversation under them. Every save path is the one the sheet already had.
- Differences from the design: no "Media, links & files" row (no such screen exists); "Search in chat"
  is "Search messages" (the existing search covers every chat you're in, plus starred messages); the
  design's preset wallpapers (Aurora, Midnight, Plain) don't exist — upload stays; no balance on the Send
  AI credits card (it isn't read until the send sheet opens); no "last seen" under the name.
- New-message email (owner, 2026-10-18: "Users should receive messages through email and push but they
  can turn off email notification in chat if they have installed the app to use push"), 0262 + lib/social/
  message-email.ts:
  · sent from the same after() step as the push, after it — no timer, no cron, nothing idle;
  · direct and secret chats; in a group only when you're @mentioned; never while you're in the chat
    (read in the last 10 minutes); one email per batch of unread messages, at most hourly per chat;
  · a secret chat's text is never emailed, and "hide previews" hides it from the email too;
  · it is OPTIONAL email: the global optional-email switch and one-click unsubscribe apply;
  · "Email me new messages" in chat options: on by default; it can be turned OFF only while the member
    has push on a device (the installed app with notifications on) — the server refuses otherwise and the
    row says why. 0262 is NOT applied until the branch reaches main.

### Outside the page steps (owner, 2026-10-18)
- `a50b9cd`: full-screen ads lost the engagement tray (brand badge, Like, views,
  Share) and its per-ad fetch; the advertiser dashboard lost Likes. Shares stays on
  the dashboard as the lifetime count, but nothing new can be shared now that the
  button is gone — say if Shares should go too.
- 2026-10-18: the first two commits (`ac4b834`, `a50b9cd`) were made on local `main`
  before the branch was named; they were moved to `ui-redesign` and local `main`
  points back at `3739e7c`. `origin/main` is 9 commits ahead and was not pulled.

### Age checks and Mature (18+) exclusive posts (owner, 2026-10-18)
The owner chose: a date of birth plus an 18+ confirmation (self-declared), protecting exclusive
posts a creator marks Mature (18+). Sexually explicit content stays banned everywhere — that keeps
the app allowed in the App Store and Play (the Android app is a TWA), and Paystack's terms forbid it.
- **0261_age_checks.sql** (NOT applied — it applies when the branch reaches main; nothing is pushed):
  `age_checks` keeps only the outcome — adult, or minor with the day they turn 18 — never the date
  of birth. Server-written only: a member reads their own row and cannot write one.
  `sub_posts.mature` (default false; every existing post stays as it is).
- **Server** (lib/age, app/api/age, lib/sub/posts.ts, feed.ts, interactions.ts): a Mature post's
  media, preview, caption and public cover go only to the creator and to viewers whose check says
  adult — in the profile grid, opening a post, likes and comments, the Exclusive feed, its preview
  refresh and discover. Anyone else gets the tile marked 18+ and nothing in it; opening answers 403
  `age_required`. An adult answer is final; a minor's stands until they turn 18 (another date
  changes nothing). Fails closed: a read error or a database without 0261 opens no Mature post, and
  a Mature post is never published as an ordinary one before 0261 runs.
- **App**: the composer's "Mature (18+)" switch, an 18+ mark on Mature tiles and cards, and the age
  sheet (date of birth, the 18+ confirmation; a minor is told the date they can open them). The
  sheet loads only when a Mature post is tapped.
- **Tests**: lib/age/age.test.ts (birthdays, 29 February); lib/sub/age-gate.server.test.ts (the real
  routes: nothing of a Mature post reaches an unconfirmed viewer, nothing is even signed for it —
  4 cases fail with the gate removed); supabase/tests/0261_age_checks.pglite.mjs (RLS and the
  constraints; three mutants, each caught).
- **Owner, 2026-10-18 (after the first build):** "The age verification should cover both users making
  post and viewers" — a creator now confirms 18+ before publishing a Mature post or switching one to
  Mature (the server refuses otherwise; switching the mark OFF never needs it). The composer asks for
  the age when Mature is switched on; closing the check without confirming switches it back off.
  "I want admin to be able to reset someone's age answers" — Admin › Accounts shows each account's
  answer (confirmed 18+ / under 18 until a date / not confirmed — never a date of birth) with a
  Reset age button. A reset is audited (moderation_action, age_check_reset, who and what); the member
  answers again next time. An admin can never set an answer.
- Still worth knowing: a self-declared date is the weakest kind of check. Where a country requires real
  age assurance for adult content (UK Online Safety Act, some US states), a provider check would be
  needed — not needed while explicit content is banned.
- The locked-content blurred preview (the owner's required fix above) is a separate, still-open job.


## Owner fixes, 2026-10-19 (after the 6d16680 push)
- [x] **History grid video ad fits** — in the Frenz grid the self-ad tile takes the grid's 3:4 tile shape,
  square on the phone, like the tiles around it (`withGridAds(…, frenz)`).
- [x] **Download page ad order** — the ad slot now sits under the Wallpapers / Frenz AI buttons, as on the landing
  (the landing's rotating ad stack also comes after the tools).
- [x] **Profile and Feed tab rows** — scroll sideways only (`touch-pan-x`, `overflow-y-hidden`, the underline
  inside the row, so nothing overflows down); a 12 px gap above the cards.
- [x] **Chat bubbles in Safari** — "Afa na" was breaking one word per line on iPhone. The bubble's
  `white-space: pre-wrap` made WebKit size it slightly narrower than its own text; removed (RichText keeps
  typed line breaks). Reproduced and checked in Playwright WebKit: short messages are one line (46 px), long
  ones still wrap at 80 %.
- [x] **Lighter History** — the publish-sound sheet and the reward gate load only when first opened;
  `app/icon.png` recompressed 163 KB → 24 KB; the Exclusive feed loads the post card as its own chunk.
