# Design rebuild — progress

One page at a time, in order. Each step is committed locally (never pushed) and
stops for the owner's review before the next one starts.

- [x] 0. Foundation (tokens, fonts, BottomNav, VerifiedBadge, Avatar, IconButton, SectionHeader, Card, Input, SegmentedControl) — frenz-* tokens + Sora/Hanken fonts, shared primitives in features/frenz-ui, the existing bottom nav restyled to the design with a white fade.
- [ ] 1. Home / Download → design/Main.dc.html
- [ ] 2. Feed → design/Feed.dc.html
- [ ] 3. Messages → design/Messages.dc.html
- [ ] 4. Chat → design/Chat.dc.html
- [ ] 5. Profile → design/Profile.dc.html
- [ ] 6. History → design/History.dc.html (owner's screenshot, 2026-10-18; the .dc.html is not in the folder yet)

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
- The brand gradient only on: primary actions (Download, new message, chat
  mic/send), active indicators, identity (logo, avatar/story rings, nav profile
  button), small badges (PRO, counts), and the AI Studio / Wallpapers showcase
  cards. Never on backgrounds, rows, plain cards, secondary/icon buttons, text,
  dividers, borders, washes or glows.

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

