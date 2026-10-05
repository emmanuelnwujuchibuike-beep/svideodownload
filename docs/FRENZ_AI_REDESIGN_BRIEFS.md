# Frenz AI — the 11-page redesign, the Image to Video spec, the landing promo

> Owner-supplied 2026-10-05, three messages in one session, checked in verbatim
> so they survive context compaction (same reason as
> `FRENZ_AI_UI_EVOLUTION_BRIEF.md`). **Do not edit the brief text; record
> progress in the ledger at the end.**
>
> How they relate:
>
> 1. **Brief A — the 11-page redesign** is the governing instruction. It
>    supersedes the 16-phase brief's "stop after Phase 1": all 11 pages, one at a
>    time, each through its full gate, no approval stops, then one consistency
>    audit and one performance audit.
> 2. **Brief B — Image to Video premium glass** is the detailed spec for Brief A's
>    Phase 4. Where B asks for more glass than A allows, A's "reduce glass" wins
>    for blur layers; B's own §19–§20 already say glass only on major surfaces.
> 3. **Brief C — the landing promotional showcase** is NOT one of Brief A's 11
>    pages and Brief A says "do not redesign unrelated areas", so it is queued.
>    The owner's decisions on it (below) are recorded so it can start cold.
>
> **Owner's answers in the same session (2026-10-05):**
>
> - Scope question → "Phase 1 only, queue rest", then superseded minutes later by
>   Brief A ("Do NOT stop after Page 1").
> - On the 2026-09-09 rule ("AI must NOT be publicly exposed as a major
>   landing-page feature"), verbatim: *"the promo should replace rule , and
>   replace the explore button in the landing page with the frenz ai promo
>   showcase , and it should be very noticeable , anonymous users should only see
>   the welcome page and scription , when their click the explore it show a pop
>   up modal that says sign in or login to use frenz ai features."*
>   ⇒ The 09-09 rule is REPLACED. Anonymous visitors may see the `/ai` welcome
>   page (Phase 1 does this); every tool behind it stays sign-in only; Explore
>   opens a sign-in modal for them.

---

## Brief A — apply the Frenz AI design system across the existing AI product (11 pages)

IMPORTANT: READ THIS ENTIRE INSTRUCTION BEFORE MAKING ANY CHANGES.

I want you to apply the new Frenz AI visual/design system across the EXISTING AI product.

IMPORTANT:
Almost everything is ALREADY BUILT.

This is NOT a request to build new features, routes, backend systems, or pages.

The task is to visually and interactively upgrade the EXISTING AI pages so they all share the same premium, lightweight design language.

==================================================
REFERENCE / DESIGN DIRECTION
==================================================

Use the attached/reference Frenz AI screenshot as the structural reference.

The desired visual direction is:

Frenz AI existing brand
+
Lagos Life's lightweight restraint
+
Snapchat-like mobile simplicity
+
premium modern AI product design

The final result should feel:

- Premium
- Lightweight
- Fast
- Clean
- Friendly
- Modern
- Mobile-first
- Visually consistent
- Easy to scan
- High quality without being visually heavy

DO NOT turn it into a generic SaaS dashboard.

DO NOT overuse glassmorphism.

DO NOT make everything glow.

DO NOT add unnecessary animations.

DO NOT make every element a card.

==================================================
VERY IMPORTANT: EVERYTHING ALREADY EXISTS
==================================================

Do NOT create:

- New AI products
- New routes
- New backend systems
- New generation APIs
- New authentication
- New profile/settings systems
- New history systems
- New support systems

Those are OUT OF SCOPE.

The following pages/features already exist.

Your job is to upgrade their UI/UX, not rebuild their functionality.

==================================================
PAGES TO UPGRADE
==================================================

Apply the design system to ALL of these:

1. Welcome / AI Landing
2. AI Studio / Home
3. Text to Video
4. Image to Video
5. Text to Audio
6. Voice Cloning
7. Lip Sync
8. Your Audios
9. Your Videos
10. Credit Balance
11. Plans / Pricing

ONLY these AI areas are part of this redesign.

Do not redesign Profile, Settings, Support, authentication, etc.

==================================================
CRITICAL EXECUTION RULE
==================================================

You ARE completing all 11 pages in this task.

BUT:

YOU MUST IMPLEMENT THEM ONE AT A TIME.

Do NOT modify all 11 pages simultaneously.

The workflow must be:

PAGE 1
→ inspect
→ implement
→ test
→ visually review
→ performance check
→ fix
→ lock the design

THEN

PAGE 2
→ inspect
→ implement
→ test
→ visually review
→ performance check
→ fix
→ lock

Continue this process until Page 11 is complete.

Do not move to the next page until the current page passes its checks.

The reason is consistency and quality.

PAGE 1 establishes the design language.

PAGE 2 must inherit the system from Page 1.

PAGE 3 must inherit the refined system from Pages 1–2.

And so on.

Do NOT create 11 slightly different interpretations of the same design.

==================================================
PHASE ORDER
==================================================

PHASE 1
Welcome / AI Landing

PHASE 2
AI Studio / Home

PHASE 3
Text to Video

PHASE 4
Image to Video

PHASE 5
Text to Audio

PHASE 6
Voice Cloning

PHASE 7
Lip Sync

PHASE 8
Your Audios

PHASE 9
Your Videos

PHASE 10
Credit Balance

PHASE 11
Plans / Pricing

After Phase 11:

Perform ONE final cross-page consistency audit.

==================================================
FIRST: READ THE EXISTING PROJECT
==================================================

Before changing anything:

Inspect the repository thoroughly.

Identify:

- Next.js structure
- App Router
- Existing AI routes
- Existing AI components
- Shared components
- Tailwind configuration
- Global CSS
- Design tokens
- Existing fonts
- Existing colors
- Existing icons
- Existing image system
- Existing animations
- Existing loading states
- Existing progress states
- Existing generation flows
- Existing API calls
- Existing entitlement/credit logic
- Existing plan logic
- Existing responsive behavior

Do not guess.

Reuse what already exists.

If a reusable component already exists, improve it rather than creating a duplicate.

==================================================
DESIGN SYSTEM
==================================================

Create ONE coherent visual system that can be shared across the existing AI pages.

The pages should NOT look identical.

They should look like they belong to the same product.

Shared:

- Typography
- Buttons
- Inputs
- Cards
- Spacing
- Radius
- Borders
- Colors
- Navigation
- Headers
- Progress indicators
- Loading states
- Empty states
- Error states
- Selection controls
- Upload controls
- CTA behavior

But each page should retain its own purpose.

==================================================
TYPOGRAPHY
==================================================

Use maximum TWO font families.

Existing fonts:

Inter
Outfit

Do not introduce another font unless there is an extremely strong reason.

INTER:
Use for:

- Body
- Navigation
- Buttons
- Labels
- Inputs
- Metadata
- Controls
- Descriptions
- Credits
- Plans
- Supporting text

OUTFIT:
Use selectively for:

- Hero H1
- Major showcase headings
- Important display moments

DO NOT use Outfit everywhere.

The hero should feel more expressive than the normal interface.

Do not make every heading look like a marketing poster.

Typography should feel:

clean
premium
friendly
confident

==================================================
BRAND
==================================================

PRESERVE THE EXISTING FRENZ AI BRAND.

Do NOT change:

- Frenz AI logo
- Brand identity
- Existing primary colors
- Existing product name
- Existing functionality

Use the existing brand colors more intelligently.

Do not invent a completely new palette.

==================================================
VISUAL WEIGHT
==================================================

The current design is visually heavier than the desired direction.

Reduce:

- Glassmorphism
- Backdrop blur
- Large shadows
- Heavy borders
- Excessive gradients
- Glowing edges
- Nested cards
- Excessive rounded containers
- Decorative UI

Prefer:

- Clean backgrounds
- Light surfaces
- Thin borders
- Small/subtle shadows
- Strong spacing
- Clear hierarchy
- Minimal gradients
- Simple controls

If an element does not need a card, do not put it in a card.

If an element does not need a shadow, remove the shadow.

If an animation doesn't improve usability, remove it.

==================================================
BUTTON SYSTEM
==================================================

Create ONE consistent button system across all AI pages.

PRIMARY:

Used for:

Create with AI
Generate
Generate Video
Generate Audio
Clone Voice
Lip Sync
Download
Continue

Style:

- Frenz brand color/gradient
- Premium
- Medium height
- Comfortable touch target
- Moderate radius
- Strong typography
- Minimal glow
- No glass effect

SECONDARY:

Used for:

Explore
Cancel
Back
View
Learn more
Other secondary actions

Keep these quieter.

Do not make every button a gradient.

==================================================
INTERACTION
==================================================

Hover:

- subtle brightness change
- tiny elevation
- slight icon movement
- smooth transition

Pressed:

- approximately 98% scale
- quick response

Cards:

- subtle border emphasis
- maximum 1–2px visual elevation
- no dramatic zoom

Selected controls:

- clear border
- subtle background tint
- strong enough to understand immediately

Do NOT use flashy hover animations.

Mobile should use pressed/tap feedback instead of relying on hover.

==================================================
INPUTS
==================================================

All AI input experiences should feel related.

Prompt areas should be:

- spacious
- clean
- easy to understand
- visually important
- lightweight

Avoid:

giant glass containers
multiple nested cards
excessive shadows

The input should feel like a premium creative workspace.

==================================================
SHOWCASE / CAROUSEL
==================================================

For the Welcome page showcase:

- Automatically advance every 3 seconds.
- User can manually swipe/scroll.
- User interaction temporarily pauses autoplay.
- Resume after 6 seconds of inactivity.
- Stop autoplay when the tab is hidden.
- Respect prefers-reduced-motion.
- Use CSS scroll-snap.
- No new carousel package.
- No polling.
- Keep JavaScript minimal.
- Use responsive images.
- First slide should load with priority.
- Other slides should load appropriately/lazily.

The showcase should feel premium but lightweight.

==================================================
PERFORMANCE IS A HARD REQUIREMENT
==================================================

DO NOT make the application materially heavier.

Performance is more important than visual effects.

Avoid:

- New large dependencies
- Heavy animation libraries
- Continuous animations
- Large blur effects
- Unnecessary client-side JavaScript
- Duplicate API requests
- Unnecessary server requests
- Polling where it isn't required
- Repeated data fetching

Use CSS wherever possible.

Reuse existing components.

==================================================
VERCEL COST
==================================================

Do not increase Vercel usage unnecessarily.

Avoid:

- New server functions for simple UI
- Unnecessary server requests
- Repeated data fetching
- Unnecessary dynamic rendering
- Excessive revalidation
- Large server payloads

Keep existing caching behavior unless there is a clear reason to improve it.

==================================================
RAILWAY COST
==================================================

Do not increase Railway workload.

Do not add:

- unnecessary polling
- repeated generation requests
- unnecessary database reads
- unnecessary websocket connections
- background processes caused only by UI

Preserve the existing generation architecture.

==================================================
IMAGE PERFORMANCE
==================================================

Use existing image infrastructure where possible.

For new/updated showcase images:

- responsive sizes
- compressed formats
- appropriate dimensions
- lazy loading below the fold
- priority only for above-the-fold content

Do not load oversized images unnecessarily.

==================================================
MOBILE FIRST
==================================================

Primary experience:

Mobile.

Test at minimum:

320px
375px
390px
430px

Then tablet and desktop.

Check:

- horizontal overflow
- safe-area behavior
- touch targets
- keyboard/input behavior
- bottom navigation
- carousel swiping
- text wrapping
- CTA positioning
- viewport height

==================================================
PAGE-SPECIFIC RULE
==================================================

Each page must preserve its existing purpose and functionality.

For example:

TEXT TO VIDEO

Keep its existing:
- prompt
- style
- duration
- aspect ratio
- reference/upload
- generation flow

But make the UI visually consistent with the new system.

IMAGE TO VIDEO

Keep its existing image/video workflow.

TEXT TO AUDIO

Keep its existing audio controls.

VOICE CLONING

Keep the existing voice upload/recording/settings flow.

LIP SYNC

Keep the existing video/audio/lip-sync workflow.

YOUR AUDIOS

Keep existing audio history/content functionality.

YOUR VIDEOS

Keep existing video history/content functionality.

CREDIT BALANCE

Keep existing balance/usage information.

PLANS

Keep existing pricing/subscription functionality.

DO NOT CHANGE PRODUCT LOGIC TO MAKE THE UI FIT THE DESIGN.

Adapt the design around the existing functionality.

==================================================
PAGE-BY-PAGE QUALITY GATE
==================================================

After EACH page:

1. Run typecheck.
2. Run lint.
3. Run relevant tests.
4. Check the page at mobile widths.
5. Check desktop.
6. Check console for errors.
7. Check network/request behavior.
8. Check image loading.
9. Check layout shift.
10. Check that existing functionality still works.
11. Check that no unrelated page broke.

Only then move to the next page.

==================================================
IMPORTANT: DESIGN SYSTEM EVOLUTION
==================================================

Do NOT freeze the first page's implementation blindly.

As you work through the pages:

If you discover a reusable improvement that benefits the whole AI system:

- Extract it into the shared component/design system.
- Apply it to already completed pages if necessary.
- Then continue.

The goal is a SINGLE coherent system, not 11 isolated page redesigns.

==================================================
FINAL CONSISTENCY AUDIT
==================================================

After all 11 pages are complete, inspect them together.

Check:

Typography
Spacing
Button height
Button radius
Input radius
Card radius
Borders
Shadows
Brand colors
Hover states
Pressed states
Loading states
Progress states
Navigation
Mobile behavior
Desktop behavior
Empty states
Error states

Make sure no page feels like it belongs to an older version of Frenz AI.

==================================================
FINAL PERFORMANCE AUDIT
==================================================

At the end compare the overall result against the original.

Check:

- bundle size
- JS added
- number of dependencies
- request count
- image payload
- layout shift
- build time if available
- client/server boundaries
- unnecessary rerenders
- Vercel-sensitive server activity
- Railway-sensitive backend activity

Do not optimize blindly.

If the redesign is visually better but materially heavier, fix the cause.

==================================================
IMPORTANT FINAL RULE
==================================================

Do the ENTIRE 11-page redesign in this task.

But execute it sequentially:

1 → finish
2 → finish
3 → finish
4 → finish
5 → finish
6 → finish
7 → finish
8 → finish
9 → finish
10 → finish
11 → finish
→ final consistency audit
→ final performance audit

Do NOT stop after Page 1.

Do NOT ask me for approval between pages.

Do NOT work on all pages simultaneously.

Do NOT redesign unrelated areas of the product.

The objective is to finish the complete AI visual redesign while preserving the existing product and keeping the application lightweight, fast and cost-efficient.

START NOW:

First inspect the project and establish the shared design system.

Then begin with PAGE 1 — Welcome.

Complete it and test it before moving to PAGE 2.

Continue sequentially until all 11 pages and the final audit are complete.

---

## Brief B — Image to Video premium glass redesign + performance (= Brief A Phase 4)

FRENZ AI — IMAGE TO VIDEO PREMIUM GLASS REDESIGN + PERFORMANCE

Redesign the existing Frenz AI → Image to Video page into a premium, cinematic, glassmorphism AI creation experience.

IMPORTANT:
Use the existing Image-to-Video functionality, API integrations, authentication, credits, wallet, navigation, upload handling, validation, generation flow, and backend logic.

Do NOT rebuild working backend functionality.
Do NOT remove existing features.
Do NOT change existing API contracts unless absolutely necessary.
Do NOT create duplicate systems for credits, pricing, authentication, uploads, or generation.

This task is primarily a frontend UI/UX redesign plus performance optimization.

The final result should feel like a premium AI creative platform: cinematic, luxurious, minimal, intelligent, and extremely smooth.

The design should match the new premium Frenz AI homepage and Text-to-Video page so the entire AI Studio feels like one cohesive product.

==================================================
1. DESIGN DIRECTION
==================================================

Transform the current Image-to-Video page from a traditional form into a premium AI creation workspace.

The primary user journey must remain extremely clear:

UPLOAD IMAGE
↓
DESCRIBE MOTION
↓
OPTIONAL REFERENCES
↓
CHOOSE SETTINGS
↓
GENERATE VIDEO

The page should feel similar in quality to modern premium AI creative platforms, but DO NOT copy Kling AI's exact layout, branding, typography, colors, or components.

Use Frenz's own visual identity:

- Electric blue
- Indigo
- Purple
- Subtle cyan
- Very subtle magenta accents
- White / near-white glass
- Dark text

Do not make pink the dominant color.

The interface should feel:

- Premium
- Cinematic
- Professional
- Modern
- Apple/iOS-inspired
- Clean
- Spacious
- Fast
- Intelligent

Avoid:

- Cartoon-like UI
- Excessive gradients
- Excessive shadows
- Neon cyberpunk styling
- Huge icons
- Overly colorful cards
- Clutter
- Excessive animations

==================================================
2. PAGE BACKGROUND
==================================================

Use a predominantly white background with an extremely subtle atmospheric AI environment.

Add very subtle static radial gradients:

- soft blue glow
- soft purple glow
- subtle indigo glow
- tiny cyan accent

The background should feel like light passing through frosted glass.

DO NOT use:

- WebGL
- Canvas particles
- animated background particles
- continuously animated gradients
- expensive blur animations

Use lightweight CSS radial gradients and pseudo-elements.

The background must remain static.

Performance is more important than decorative effects.

==================================================
3. TOP NAVIGATION
==================================================

Keep all existing navigation functionality.

Redesign the header as a lightweight premium glass header.

Structure:

[Frenz Logo]                         [Globe] [Profile] [Menu]

Use:

- translucent white
- subtle border
- small backdrop blur
- soft shadow
- rounded surfaces where appropriate

Keep the header compact.

Do not make the header excessively tall.

Preserve iPhone safe-area spacing.

Do not break:

- profile
- language
- menu
- authentication
- navigation routes

==================================================
4. PAGE HERO
==================================================

Keep the existing concept:

"Bring a photo to life."

Redesign the typography so it matches the premium Frenz AI visual language.

Use:

"Bring a photo"
in dark/black text.

Use:

"to life."
with a subtle Frenz blue → purple gradient.

Supporting text:

"Turn a still image into a cinematic video with Frenz AI."

Keep the supporting copy short.

Do not create a huge block of introductory text.

The hero should quickly transition into the creation workspace.

==================================================
5. OPTIONAL CINEMATIC SHOWCASE
==================================================

If the existing Frenz AI architecture already supports a showcase carousel, place a cinematic showcase card near the top of the page.

Example:

┌──────────────────────────────────────┐
│                                      │
│          CINEMATIC CREATION          │
│                                      │
│  Image to Video                      │
│  Bring still images to life.         │
│                                      │
│                       ● ○ ○ ○        │
└──────────────────────────────────────┘

The showcase should support:

- automatic sliding
- manual swipe
- drag
- pagination
- smooth transitions

BUT:

Performance comes first.

Do NOT load multiple large videos.

Use optimized WebP/AVIF images where possible.

Only preload the first visible showcase image.

Lazy-load other slides.

If the showcase would significantly increase the page's initial load, do not add it to the Image-to-Video page.

The creation interface is more important.

==================================================
6. AI BALANCE / CREDIT STATUS
==================================================

Add a compact glass status pill below the hero.

Example:

"✦ 6 free creations left · 24 AI credits · View balance →"

Use the user's REAL existing balance data.

Do NOT hardcode:

- credits
- free creations
- pricing
- subscription status

Connect to the existing wallet/credit system.

Clicking "View balance" should use the existing AI Balance / Wallet route.

Make this component reusable across:

- Text to Video
- Image to Video
- Lip Sync
- Voice
- other AI tools

==================================================
7. MAIN CREATION WORKSPACE
==================================================

Create one large premium glass creation surface.

Do not make the page feel like a collection of unrelated white boxes.

The main workspace should visually group the complete Image-to-Video workflow.

Concept:

┌───────────────────────────────────────────┐
│                                           │
│  Your photo                               │
│  JPEG · PNG · up to 10 MB                 │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │                                     │  │
│  │               +                     │  │
│  │                                     │  │
│  │          Choose a photo             │  │
│  │                                     │  │
│  │        or drag one here             │  │
│  │                                     │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  What should happen?                      │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │ Describe the movement...             │  │
│  │                                     │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  References                               │
│                                           │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐             │
│  │ +  │ │ +  │ │ +  │ │ +  │             │
│  └────┘ └────┘ └────┘ └────┘             │
│                                           │
│  Duration       Aspect Ratio              │
│  5 seconds      16:9                     │
│                                           │
│  Estimated cost           Generate →      │
└───────────────────────────────────────────┘

Use generous spacing.

Do not make the workspace unnecessarily tall.

==================================================
8. IMAGE UPLOAD
==================================================

Create a premium glass upload area.

Initial state:

┌──────────────────────────────────┐
│                                  │
│              ✦                   │
│                                  │
│        Choose a photo            │
│                                  │
│        or drag one here          │
│                                  │
│      JPEG · PNG · up to 10 MB    │
│                                  │
└──────────────────────────────────┘

Use:

- subtle dashed border
- translucent glass
- small premium icon
- clean typography

Do not use a huge illustration.

Keep it lightweight.

==================================================
9. IMAGE UPLOAD PERFORMANCE
==================================================

When a user selects an image:

1. Validate file type.
2. Validate file size.
3. Create a local preview.
4. Display the preview immediately.
5. Do not upload immediately unless the existing architecture requires it.
6. Upload only when generation actually requires the file.
7. Optimize the image when appropriate.
8. Send the optimized asset through the existing backend/API workflow.

Use URL.createObjectURL() for local previews.

Properly revoke object URLs:

URL.revokeObjectURL()

when the image changes or the component unmounts.

DO NOT:

- convert large images to base64 unnecessarily
- store images in localStorage
- duplicate File objects
- create multiple canvas copies
- upload the same file more than once
- keep unnecessary image blobs in React state

Keep the actual File object in the appropriate local component/state structure only as long as necessary.

==================================================
10. IMAGE PREVIEW
==================================================

After upload, transform the upload area into a premium image preview.

Example:

┌──────────────────────────────────┐
│                                  │
│          UPLOADED IMAGE          │
│                                  │
│                              ×   │
│                                  │
└──────────────────────────────────┘

Include:

- image preview
- remove button
- replace image action

Use object-fit: cover where appropriate.

Do not render duplicate previews.

Do not create multiple copies of the image.

==================================================
11. MOTION PROMPT
==================================================

Keep:

"What should happen?"

Supporting text:

"Optional — describe the motion, or leave it and let the model decide."

Create a premium glass textarea.

Placeholder:

"A slow, gentle push in. The light shifts softly."

Preserve the existing character limit.

Show:

"0 / 2,500"

The counter should be subtle.

Do not make it visually dominant.

==================================================
12. AI PROMPT ENHANCEMENT
==================================================

If the existing prompt enhancement functionality exists, keep it.

Place a small premium sparkle button inside or beside the textarea.

Example:

✦

Clicking it should use the EXISTING prompt enhancement functionality.

Do NOT create a new AI API.

The enhancement feature must:

- preserve the existing prompt
- show loading state
- prevent duplicate requests
- handle errors gracefully
- never freeze the UI

==================================================
13. REFERENCES
==================================================

Keep the existing References functionality.

Design it as a premium glass section.

Title:

"References · optional"

Counter:

"0/7"

Keep the existing supported reference functionality.

Example:

┌────┐ ┌────┐ ┌────┐ ┌────┐
│ +  │ │ +  │ │ +  │ │ +  │
└────┘ └────┘ └────┘ └────┘

Uploaded references should show thumbnails.

Only create thumbnails for files the user actually selects.

Do not preload reference images.

Do not load unnecessary media.

==================================================
14. GENERATION SETTINGS
==================================================

Use compact glass controls.

Example:

Duration
5 seconds →

Aspect Ratio
16:9 →

If the existing backend supports more settings, preserve them.

Do not expose every advanced option by default.

Use progressive disclosure.

Example:

"Advanced settings"

opens additional options.

Keep the default mobile interface simple.

==================================================
15. ESTIMATED COST
==================================================

Keep the existing estimated cost functionality.

Design it as part of the bottom generation area.

Example:

ESTIMATED COST
4 credits

                         Generate Video →

The actual price MUST come from the existing pricing/credit configuration.

Never hardcode pricing.

If pricing requires a server request:

- debounce requests
- avoid requesting on every keystroke
- cache results where appropriate
- only recalculate when a pricing-relevant setting changes

==================================================
16. GENERATE BUTTON
==================================================

Create a premium Frenz CTA.

Example:

"✦ Generate Video →"

Use a subtle:

blue → indigo → purple

gradient.

The button should not look like a giant neon button.

It should feel like a premium native application action.

Disable it when required input is missing.

Show the actual generation cost when available.

Example:

"✦ Generate · 4 credits"

Do not hardcode the credit amount.

==================================================
17. GENERATION STATES
==================================================

Implement polished states for the existing generation flow.

IDLE:

Generate button available only when required inputs exist.

UPLOADING:

"Uploading image..."

Show progress if the existing upload system provides it.

PREPARING:

"Preparing your creation..."

GENERATING:

"Creating your video..."

Show a lightweight progress animation.

COMPLETED:

Show the generated video inside a premium glass result card.

FAILED:

"Something went wrong."

"Try again"

Do not expose raw API errors.

Do not allow accidental duplicate generation requests.

Disable the Generate button while a generation request is already active.

==================================================
18. GENERATED VIDEO RESULT
==================================================

After successful generation, display the result in a premium glass card.

Include existing supported actions such as:

- video preview
- play/pause
- download
- create again
- share
- use as reference if supported

Do not automatically autoplay with sound.

Use a poster/thumbnail where possible.

Do not download or preload the full video unnecessarily before the user requests playback.

==================================================
19. GLASS DESIGN SYSTEM
==================================================

Create reusable components/classes rather than individually styling every element.

Recommended reusable components:

GlassSurface
GlassCard
GlassInput
GlassTextarea
GlassButton
GlassPill
GlassSection
GlassBottomBar

Use a consistent design language.

Glass should use:

- translucent white
- subtle border
- moderate backdrop blur
- soft shadow
- rounded corners

IMPORTANT:

Do NOT apply backdrop-filter to every nested element.

Use glass primarily on major surfaces.

Inner controls can use translucent backgrounds without their own backdrop blur.

The interface should remain attractive even when backdrop-filter is unavailable.

==================================================
20. GLASS PERFORMANCE
==================================================

The page should LOOK heavily glass without actually becoming computationally heavy.

Do NOT use:

backdrop-filter: blur(30px)

on dozens of components.

Instead:

- use moderate blur
- limit blur layers
- avoid nested backdrop filters
- avoid animated blur
- avoid huge box shadows
- avoid giant fixed blurred elements
- avoid excessive compositing layers

Prefer:

background: rgba(...)
border: 1px solid rgba(...)

for smaller elements.

Reserve backdrop-filter for major glass surfaces.

==================================================
21. MOBILE PERFORMANCE
==================================================

The primary targets are:

- iPhone Safari
- iOS PWA
- Android Chrome
- lower-memory Android devices

Optimize specifically for mobile.

Avoid:

- WebGL
- canvas effects
- particle systems
- heavy animation libraries
- continuously animated backgrounds
- expensive carousel libraries
- unnecessary observers
- huge DOM trees
- unnecessary React renders

Use CSS transforms for animations.

Use opacity and transform for transitions.

Avoid animating:

- width
- height
- top
- left
- box-shadow
- filter

where possible.

Prefer:

transform
opacity

for smooth GPU-friendly animations.

==================================================
22. IMAGE OPTIMIZATION
==================================================

All static showcase/marketing images should use modern optimized formats where possible:

AVIF
WebP

Use responsive image sizes.

Do not ship a 4K image to a mobile phone when a 600–1000px version is enough.

Use responsive srcset/sizes where appropriate.

Example concept:

Mobile:
~640px image

Tablet:
~1024px image

Desktop:
~1440px image

Do not load desktop-sized images on mobile unnecessarily.

==================================================
23. LAZY LOADING
==================================================

Lazy-load:

- secondary showcase images
- below-the-fold media
- generated video previews that aren't visible
- non-critical images
- optional content

Do NOT lazy-load the primary content required for the first viewport.

The first visible hero/image should load as quickly as possible.

==================================================
24. LCP / INITIAL LOAD
==================================================

The redesign MUST NOT significantly increase LCP.

Target:

Fast first render.

The first viewport should become interactive quickly.

Do not introduce large dependencies just for visual effects.

Avoid importing an entire animation library for a few transitions.

Prefer:

- CSS
- native browser APIs
- existing project utilities
- lightweight React components

Do not introduce unnecessary npm packages.

==================================================
25. JAVASCRIPT PERFORMANCE
==================================================

Avoid unnecessary client-side JavaScript.

Keep static UI server-renderable where the existing framework allows it.

Do not turn the entire page into a client component unnecessarily.

Only interactive sections should require client-side state.

Avoid unnecessary global state.

Avoid storing temporary form state globally if local state is sufficient.

Use memoization only where it actually improves performance.

Do not overuse useMemo/useCallback without a measurable reason.

==================================================
26. REACT PERFORMANCE
==================================================

Prevent unnecessary re-renders.

The following should not cause the entire page to rerender:

- typing in the prompt
- changing duration
- selecting aspect ratio
- selecting references
- hovering cards

Keep interactive state as local as possible.

Use stable component boundaries.

Do not recreate large arrays/objects on every render unnecessarily.

==================================================
27. UPLOAD PERFORMANCE
==================================================

Prevent duplicate uploads.

When a user selects an image:

- immediately show local preview
- validate it
- track upload state
- cancel stale uploads where supported
- prevent multiple simultaneous uploads
- clean up object URLs
- handle failed uploads gracefully

If the user replaces the image before an upload completes, cancel/ignore the previous upload where possible.

==================================================
28. API PERFORMANCE
==================================================

Do not add unnecessary API requests.

Do not fetch:

- user balance repeatedly
- pricing repeatedly
- feature configuration repeatedly

Use the application's existing cached/user state where possible.

If the existing architecture already provides these values, reuse them.

For requests that must be refreshed:

- debounce
- cache
- deduplicate
- invalidate only when necessary

Do not poll the backend unnecessarily.

==================================================
29. GENERATION REQUEST PROTECTION
==================================================

Prevent accidental duplicate generations.

When the user presses Generate:

1. Validate input.
2. Confirm required balance/credits.
3. Disable duplicate submission.
4. Submit generation request.
5. Track job state using the existing architecture.
6. Re-enable/recover correctly on completion or failure.

Do not create multiple jobs if the user taps the button repeatedly.

==================================================
30. ACCESSIBILITY
==================================================

Maintain strong accessibility.

Use:

- semantic buttons
- proper labels
- keyboard accessibility
- visible focus states
- sufficient contrast
- accessible upload controls
- accessible icon buttons
- aria-labels where needed

Do not sacrifice accessibility for glass aesthetics.

Do not use extremely low-opacity text.

The glass background must never make text difficult to read.

Respect:

prefers-reduced-motion

When reduced motion is enabled:

- disable carousel animation
- reduce transitions
- remove decorative movement

==================================================
31. BOTTOM NAVIGATION
==================================================

Keep the existing bottom navigation functionality.

Redesign it as a lightweight floating glass navigation bar.

Maintain:

- Home
- Explore
- History
- Support
- Profile

Use:

- subtle transparency
- moderate blur
- thin border
- safe-area support
- compact height

Do not make the bottom bar excessively tall.

Do not allow it to cover the Generate button or important form controls.

Add sufficient bottom padding to the page so content can scroll above it.

==================================================
32. RESPONSIVE DESIGN
==================================================

Mobile is the primary design target.

At small mobile widths:

- stack controls
- keep buttons touch-friendly
- maintain readable text
- avoid horizontal overflow
- keep the creation workspace comfortable

On tablets:

- increase spacing moderately
- allow wider form layout

On desktop:

- center the workspace
- use a comfortable max-width
- optionally use a two-column layout where useful

Do not simply stretch the mobile design across a desktop screen.

==================================================
33. TOUCH INTERACTION
==================================================

Mobile interactions should feel native.

Buttons should have comfortable touch targets.

Use subtle press feedback:

scale(0.98)

or similar.

Do not use exaggerated animations.

The image upload area should respond immediately to tapping.

Horizontal showcase interactions, if implemented, must support natural touch swiping.

==================================================
34. NO VISUAL REGRESSION
==================================================

Do not remove or break existing functionality.

Before finishing, verify:

- image upload works
- image replacement works
- image removal works
- prompt works
- prompt character counter works
- references work
- duration works
- aspect ratio works
- pricing works
- credits work
- generation works
- generation status works
- result display works
- download works
- authentication works
- navigation works
- wallet works
- bottom navigation works

==================================================
35. DO NOT DUPLICATE EXISTING SYSTEMS
==================================================

Before creating anything new, inspect the existing codebase.

Reuse existing:

- components
- hooks
- API functions
- services
- credit utilities
- pricing utilities
- upload utilities
- authentication
- user state
- wallet state
- navigation
- generation state
- error handling

If an equivalent component already exists, improve/reuse it instead of creating another implementation.

==================================================
36. CODE QUALITY
==================================================

Keep the implementation maintainable.

Avoid:

- giant components
- duplicated styles
- duplicated API logic
- duplicated credit calculations
- duplicated upload logic
- hardcoded user data
- hardcoded pricing
- hardcoded feature availability

Break the page into sensible reusable components.

For example:

ImageToVideoPage
ImageUploadCard
MotionPrompt
ReferenceUploader
GenerationSettings
EstimatedCost
GenerateButton
GenerationResult
CreditStatus
GlassSurface

Use the project's existing architecture and naming conventions where they differ.

==================================================
37. FINAL VISUAL RESULT
==================================================

The final mobile experience should feel approximately like:

FRENZ AI

[Logo]                         [Globe] [Profile] [Menu]


Bring a photo to life.

Turn a still image into a cinematic video with Frenz AI.


[ ✦ 6 free creations · 24 credits · View balance → ]


┌──────────────────────────────────────┐
│                                      │
│              YOUR PHOTO              │
│                                      │
│               +                      │
│                                      │
│          Choose a photo              │
│          or drag one here            │
│                                      │
└──────────────────────────────────────┘


┌──────────────────────────────────────┐
│ What should happen?                  │
│                                      │
│ A slow cinematic push in...          │
│                                      │
│                                  0/2500
└──────────────────────────────────────┘


References · optional

[ + ] [ + ] [ + ] [ + ]


┌──────────────────┐  ┌──────────────────┐
│ Duration         │  │ Aspect Ratio     │
│ 5 seconds     →  │  │ 16:9          →  │
└──────────────────┘  └──────────────────┘


ESTIMATED COST

4 credits                 [ ✦ Generate Video → ]


[ Home ] [ Explore ] [ History ] [ Support ] [ Profile ]


The final result should feel like a premium AI application rather than a normal web form.

==================================================
38. MOST IMPORTANT PERFORMANCE RULE
==================================================

DO NOT sacrifice performance for the glass design.

The page must remain lightweight.

The visual goal is:

"Premium glass appearance with normal web performance."

Not:

"Heavy effects everywhere."

Prioritize:

1. Fast LCP
2. Fast interaction
3. Fast image preview
4. Minimal JavaScript
5. Minimal network requests
6. Optimized images
7. Smooth scrolling
8. Smooth mobile touch
9. Low memory usage
10. No unnecessary dependencies

The redesign must NOT cause:

- slow initial load
- white screen
- delayed navigation
- input lag
- keyboard lag
- scrolling stutter
- excessive memory usage
- PWA heat/battery issues
- unnecessary API requests

==================================================
39. FINAL DEVELOPMENT INSTRUCTION
==================================================

First inspect the existing Image-to-Video implementation and identify:

- current components
- existing API calls
- upload flow
- generation flow
- credit logic
- pricing logic
- wallet integration
- navigation
- existing reusable UI components
- current performance bottlenecks

Then implement the redesign using the existing architecture.

Do not rewrite functioning systems simply to match the visual design.

After implementation, test the page on mobile dimensions and verify:

- no horizontal overflow
- no layout shift
- no console errors
- no duplicate API calls
- no duplicate generation requests
- no memory leaks from image previews
- no unnecessary network requests
- no broken routes
- no broken upload flow
- no broken generation flow

Finally, audit the page for performance and remove any unnecessary animation, dependency, image, render, or API request introduced by this redesign.

The final result should be:

PREMIUM
CINEMATIC
GLASS
FAST
LIGHTWEIGHT
MOBILE-FIRST
PROFESSIONAL
FRENZ AI

---

## Brief C — Frenz AI landing promotional showcase (QUEUED — not one of Brief A's 11 pages)

Frenz AI Landing Promotional Showcase
Implement a premium, professional, lightweight promotional showcase for Frenz AI on the FrenzSave landing page.
1. Core Objective
The purpose of this feature is to make visitors clearly notice and understand Frenz AI while keeping the landing page extremely fast.
This must not turn the landing page into a heavy AI showcase or media-heavy experience.
The implementation must prioritize:
• Extremely fast initial page load
• Low JavaScript execution
• Low memory usage
• Low CPU usage
• No unnecessary re-renders
• No overheating
• No layout shifts
• No impact on existing landing-page performance
• No increase in the landing page's critical loading budget
• Excellent mobile performance, especially low-end Android devices
• Smooth but subtle transitions
• Professional native-app-quality presentation
Do not sacrifice the existing landing-page performance to implement this feature.

⸻

2. Frenz AI Button Rotation
Make the existing Frenz AI button dynamically change its displayed AI feature every 3 seconds.
The button should rotate between the currently available Frenz AI capabilities.
For example:
• AI feature 1
• AI feature 2
• AI feature 3
• AI feature 4
• AI feature 5
The exact features should be generated from the application's existing Frenz AI feature configuration rather than hardcoding a duplicate list.
Button behavior
Every 3 seconds:
1. Current AI feature gently transitions out.
2. Next AI feature transitions in.
3. The button itself must remain stable in position.
4. Do not cause layout shifting.
5. Do not recreate the entire landing section.
6. Do not trigger expensive page-wide React/component renders.
Use a lightweight transition such as:
• opacity
• very small translate
• subtle scale if appropriate
Avoid:
• particle effects
• canvas animations
• continuously running complex animations
• large blur effects
• WebGL
• heavy Framer Motion animations
• unnecessary JavaScript animation loops
Prefer CSS transitions/keyframes where possible.

⸻

3. Landing Promotional Sequence
After the visitor lands on FrenzSave:
Initial state
Do not immediately load/play the promotional video.
Give the existing landing page approximately 2 seconds to establish the initial experience.
The existing hero, navigation, primary CTA and critical content must remain the priority.
After approximately 2 seconds, begin the Frenz AI promotional sequence.

⸻

4. Promotional Sequence Timeline
The sequence should continuously repeat.
Stage 1 — Frenz AI Introduction
Display:
• Frenz AI text
• Existing/appropriate Frenz AI icons
• Very short professional description
Duration:
3 seconds
This should feel like a premium native-app promotional card rather than an advertisement banner.
Keep the design clean and spacious.

⸻

Stage 2 — Short Frenz AI Video
After the 3-second introduction:
Display a short promotional video demonstrating Frenz AI.
Duration:
3 seconds
The video itself should be approximately 3 seconds long.
Requirements:
• Autoplay only when appropriate
• Muted
• Plays inline
• No audio
• No video controls
• No unnecessary preload
• Optimized/compressed format
• Mobile-friendly dimensions
• Poster image available
• Do not download the video during the critical initial page load
The video should visually demonstrate an actual Frenz AI capability.

⸻

Stage 3 — AI Image Transformation Showcase
After the video:
Display a premium split/grid comparison.
The composition should show:
Left side: original image/background
Right side: transformed/generated result with a different background
The concept should immediately communicate:
One image → AI transformation
The image should look polished and visually impressive without requiring animation-heavy effects.
Duration:
3 seconds
Then return to:
Frenz AI introduction → Video → Image → repeat

⸻

5. Complete Loop
The loop should therefore be approximately:
2-second initial delay
↓
Frenz AI text + icons + description — 3 sec
↓
AI promotional video — 3 sec
↓
AI transformation image/grid — 3 sec
↓
Frenz AI text + icons + description — 3 sec
↓
Video — 3 sec
↓

Image — 3 sec
↓
Repeat.
The sequence must continue automatically while the visitor remains on the relevant landing section.

⸻

6. Admin-Controlled Media
The promotional media must be fully manageable from the existing Admin Dashboard.
Admin should be able to configure:
Promotional Video
• Upload/replace video
• Video thumbnail/poster
• Enable/disable video
• Preview video
• Replace video without code changes
Promotional Image
• Upload/replace image
• Preview image
• Enable/disable image
• Replace image without code changes
The system should store only the necessary media metadata in the database.
Do not store large media files directly inside the database.
Use the existing project's appropriate storage/CDN infrastructure.

⸻

7. Admin Configuration
Create a clean admin section such as:
Frenz AI Promotion
Inside it:
Promotional Video
• Current video preview
• Replace video
• Poster/thumbnail
• Enable/disable
• Save
Transformation Showcase
• Current image preview
• Replace image
• Enable/disable
• Save
Timing
Allow admin-controlled timing where appropriate, but provide sensible defaults:
• Initial delay: 2 seconds
• Intro: 3 seconds
• Video: 3 seconds
• Image: 3 seconds
Do not expose unnecessary technical settings that could allow an admin configuration to accidentally create a performance problem.

⸻

8. PERFORMANCE REQUIREMENTS — CRITICAL
This is the most important part of the implementation.
Do NOT:
• Increase the landing page's critical bundle unnecessarily
• Load the promotional video before the critical landing content
• Block rendering on media
• preload large videos
• fetch multiple promotional videos simultaneously
• load hidden media
• create continuous JavaScript timers when CSS can handle the animation
• use requestAnimationFrame loops for the entire page
• use canvas/WebGL
• add large animation libraries
• introduce heavy Framer Motion animations
• duplicate existing dependencies
• create unnecessary API requests
• repeatedly query Supabase
• repeatedly query the backend every 3 seconds
Prefer:
• CSS transitions
• CSS animation where appropriate
• lazy loading
• IntersectionObserver
• dynamic imports only if actually necessary
• optimized media
• CDN delivery
• responsive image sizes
• WebP/AVIF for images where supported
• highly compressed short video
• poster image
playsInline
muted
• preload="none" or carefully controlled loading
• browser-native media capabilities

⸻

9. Intelligent Media Loading
The media must be loaded intelligently.
The initial landing experience should load first.
Only after the page has become interactive should the promotional media begin preparing.
Use a staged loading strategy:
Priority 1
Load:
• Logo
• Navigation
• Hero
• Main CTA
• Critical above-the-fold content
Priority 2
After the initial page is interactive:
Prepare the promotional poster/image.
Priority 3
After approximately 2 seconds and when the promotional section is actually visible:
Prepare/play the video.
This prevents the AI promotion from competing with the landing page's most important resources.

⸻

10. Mobile Performance
This must work exceptionally well on:
• iPhone
• Android
• low-end Android
• slow mobile networks
• 4G
• 3G
• desktop
• tablets
On slower devices/networks, prioritize the landing page over the promotional video.
If the video cannot load quickly enough:
Do not show a loading spinner.
Instead:
• keep the poster image visible
• gracefully continue the promotional sequence
• optionally skip directly to the image showcase
The visitor should never see a broken media component.

⸻

11. Visibility Optimization
The promotional animation should only actively run while the relevant section is visible.
Use IntersectionObserver.
When the section leaves the viewport:
• pause the video
• stop the promotional cycle
• release unnecessary media resources
• prevent unnecessary timers/work
When it becomes visible again:
• resume gracefully
Do not keep expensive media processing running while the visitor is reading another section.

⸻

12. Battery and Thermal Protection

This feature must be designed with mobile battery usage in mind.
Avoid:
• constant animation loops
• high-frequency JavaScript timers
• excessive blur
• large box-shadow animations
• video playback when not visible
• simultaneous media playback
• continuous GPU-heavy effects
Use simple compositing-friendly properties such as:
• opacity
• transform
Do not animate:
• width
• height
• top
• left
• margin
• box-shadow intensity
• expensive filters
unless there is a very strong reason.

⸻

13. Reduced Motion
Respect:
prefers-reduced-motion
If enabled:
• disable unnecessary transitions
• use simple instant/fade transitions
• do not create unnecessary motion
The promotional content should remain understandable without animation.

⸻

14. Responsive Design
The promotional component must be completely responsive.
Mobile
Use a compact vertical composition with:
• Frenz AI title
• short description
• media
• minimal spacing
Tablet
Increase media size and spacing appropriately.
Desktop
Allow a larger premium presentation while maintaining the same lightweight structure.
Do not create separate heavy implementations for each breakpoint.
Prefer responsive CSS.

⸻

15. Visual Direction
The design should feel:
Premium
Professional
Modern
Native-app quality
Clean
Minimal
AI-focused without looking like an advertisement
Use the existing FrenzSave design system.
Do not introduce a completely different visual language.
Avoid:
• excessive gradients
• neon colors
• excessive glowing
• oversized text
• clutter
• unnecessary decorative elements
• generic AI clichés
• excessive rounded cards
• excessive animation
The user should immediately understand that this is an important FrenzSave capability.

⸻

16. Media Design
The image showcase should have a clear visual relationship between the two sides.
Example:
Original
→
Frenz AI Result
Use a subtle divider or visual transition.
The image should communicate the transformation immediately even without text.
The video should similarly demonstrate an actual Frenz AI capability rather than being a generic promotional animation.

⸻

17. Accessibility
Ensure:
• accessible text
• sufficient contrast
• keyboard accessibility where relevant
• meaningful image alt text
• no essential information conveyed only through animation
• reduced-motion support
• video does not autoplay with sound

⸻

18. Architecture
Before modifying anything:
First inspect the existing project.
Identify:
• current landing page architecture
• existing Frenz AI button
• existing animation system
• existing media handling
• current storage/CDN
• existing admin dashboard
• existing Supabase tables
• existing image optimization
• current performance configuration
• existing lazy-loading utilities
• existing responsive breakpoints
Do not create duplicate systems if the project already has suitable infrastructure.
Reuse existing architecture wherever possible.

⸻

19. Avoid Unnecessary Backend Traffic
The landing page must NOT make a database request every 3 seconds.
The promotional configuration should be fetched once.
Then the browser should locally rotate through the sequence.
Do not poll Supabase.
Do not repeatedly fetch configuration.
Do not create realtime subscriptions for this feature.
Cache the configuration appropriately.

⸻

20. Failure Handling
If the admin has not uploaded promotional media:
The landing page must still work perfectly.
Examples:
No video
Skip video stage and continue:
Intro → Image → Intro → Image
No image
Skip image stage:
Intro → Video → Intro → Video
No promotional media
Simply display the normal Frenz AI introduction.
Never show:
• broken images
• broken video players
• empty cards
• loading errors
• visible technical errors

⸻

21. Performance Audit After Implementation
After implementation, perform a full performance audit.
Check:
• LCP
• FCP
• CLS
• INP
• JavaScript bundle size
• CSS size
• image size
• video size
• network requests
• database requests
• memory usage
• CPU usage
• mobile performance
• animation performance
• landing-page startup time
Compare performance before vs after.

The new feature must not meaningfully degrade the existing landing-page performance.
If the promotional feature causes a measurable performance regression, optimize it before considering the implementation complete.

⸻

22. Final Quality Requirement
Do not simply make the feature work.
It must feel like a carefully engineered part of a premium production application.
The final result should communicate:
FrenzSave
→ Frenz AI
→ real capabilities
→ visual proof
→ clean premium experience
while remaining extremely lightweight.
The landing page's existing speed and performance are non-negotiable.
Definition of done
The feature is complete only when:
• Frenz AI button changes every 3 seconds
• Landing page waits approximately 2 seconds before starting the promotion
• Intro displays for 3 seconds
• Video displays for 3 seconds
• Transformation image displays for 3 seconds
• Sequence loops continuously
• Admin can replace video
• Admin can replace image
• Media is optimized and lazy-loaded
• Video does not block initial loading
• Off-screen video pauses
• No unnecessary database polling occurs
• No heavy animation library is introduced
• Mobile performance remains strong
• Reduced motion is respected
• Missing media fails gracefully
• Existing landing-page functionality remains unchanged
• Existing landing-page performance budget is preserved
• No overheating or excessive CPU/GPU activity is introduced
• The final UI looks premium, professional and native-app quality
Important: inspect the current implementation and architecture first. Do not rewrite unrelated landing-page components or change existing navigation, hero structure, branding, or functionality just to implement this feature.

---

# LEDGER

| # | Page | State | Commit | Note |
|---|---|---|---|---|
| 1 | Welcome / AI Landing | 🔨 in progress | — | anonymous may view (owner 10-05); Explore → sign-in modal |
| 2 | AI Studio / Home | ⏳ | — | |
| 3 | Text to Video | ⏳ | — | |
| 4 | Image to Video | ⏳ | — | Brief B is the spec |
| 5 | Text to Audio | ⏳ | — | |
| 6 | Voice Cloning | ⏳ | — | |
| 7 | Lip Sync | ⏳ | — | |
| 8 | Your Audios | ⏳ | — | |
| 9 | Your Videos | ⏳ | — | |
| 10 | Credit Balance | ⏳ | — | |
| 11 | Plans / Pricing | ⏳ | — | |
| — | Consistency audit | ⏳ | — | |
| — | Performance audit | ⏳ | — | vs d08cf56 built in C:\tmp\svd-base |
| C | Landing promo | ⏸ queued | — | not one of the 11; owner decisions recorded above |
