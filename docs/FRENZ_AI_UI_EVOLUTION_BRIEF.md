# Frenz AI — UI evolution brief (16 phases)

> Owner-supplied, 2026-10-05, with a reference screenshot (Text to Video screen:
> "Turn Words Into Motion" showcase carousel, credits strip, prompt card, style
> tiles, duration / aspect ratio, reference upload, gradient Generate button,
> bottom nav). Checked in verbatim so it survives context compaction — the same
> reason the Part 7 / Part 8 briefs live in this folder. **Do not edit the brief
> text; record progress in the ledger at the end.**
>
> Owner's additional instruction in the same message: *"After you're done, do
> this Frenz AI upgrade with the reference image, give all details backend and
> functions it must be light weight. The showcase card titles, description and
> images should be able to be uploaded or change by the admin, images, titles
> and descriptions must fit professional as it is in the reference image with
> the font and everything."*

---

IMPORTANT — READ THE ENTIRE PROJECT FIRST. DO NOT CODE IMMEDIATELY.

I want to evolve the existing Frenz AI product into a consistent, premium, lightweight AI interface system.

I have attached a visual reference of the current desired direction.

The design direction is:

Frenz AI brand
+
Lagos Life's lightweight typography and restraint
+
Snapchat-like simplicity, friendliness and interaction
+
Premium AI-product polish

The result must NOT feel like a generic SaaS dashboard.

It should feel like a fast, modern mobile AI app.

## PHASED IMPLEMENTATION IS REQUIRED

DO NOT redesign all pages at once.

We will implement and perfect the interface ONE PAGE AT A TIME.

The order is:

PHASE 1 — Welcome / onboarding
PHASE 2 — Main AI Studio / Home
PHASE 3 — Text to Video
PHASE 4 — Image to Video
PHASE 5 — Image generation
PHASE 6 — Audio generation
PHASE 7 — Other AI creation tools
PHASE 8 — Input / prompt states
PHASE 9 — Upload/reference states
PHASE 10 — Generation/progress states
PHASE 11 — Result/output states
PHASE 12 — History
PHASE 13 — Explore
PHASE 14 — Support
PHASE 15 — Profile/settings
PHASE 16 — Empty states, errors and edge cases

START WITH PHASE 1 ONLY.

Do not implement phases 2–16 yet unless I explicitly tell you to continue.

After Phase 1 is complete, stop and wait for my review.

## FIRST: UNDERSTAND THE EXISTING CODEBASE

Before touching code:

1. Inspect the repository.
2. Identify the framework.
3. Identify routing.
4. Identify the existing AI pages.
5. Identify shared components.
6. Identify the existing design system.
7. Identify existing typography.
8. Identify existing colors/tokens.
9. Identify the existing Frenz AI logo and assets.
10. Identify existing animation libraries.
11. Identify existing API calls.
12. Identify loading/progress states.
13. Identify image handling.
14. Identify how Vercel and Railway are currently used.
15. Identify anything that could affect performance or hosting cost.

Do not guess.

Reuse existing architecture wherever practical.

Do not create duplicate versions of components that already exist.

## DESIGN SYSTEM

Every AI page should eventually share ONE coherent design system.

The pages will have different functionality, but the visual language must remain consistent.

Shared elements should include:

- Header
- Navigation
- Typography system
- Buttons
- Inputs
- Prompt areas
- Cards
- Selection controls
- Upload controls
- Progress indicators
- Toasts
- Modals
- Bottom navigation
- AI balance/credit indicators
- Loading states
- Empty states
- Error states

Build these as reusable components/tokens where appropriate.

Do not copy/paste the same UI into every page.

## TYPOGRAPHY

Typography is extremely important.

Use the Lagos Life visual direction as inspiration for the clean, friendly typography.

However:

DO NOT use one font for absolutely everything.

Create a deliberate typography hierarchy.

Use the primary UI font for:

- Navigation
- Buttons
- Labels
- Inputs
- Body text
- Metadata
- Controls

Use a complementary display/editorial font ONLY where it adds character, particularly:

- Hero H1
- Major campaign/showcase headlines
- Occasional promotional headings

The Hero H1 should NOT simply use the same UI font at a huge size.

The combination should feel intentional.

Example:

UI:
Clean modern sans-serif.

Hero:
A refined display/serif or expressive typeface.

But keep the display font limited.

DO NOT turn the entire application into a serif interface.

Typography should feel similar in spirit to Lagos Life:
clean, confident, premium and approachable.

Do not introduce five or six fonts.

Prefer 2 font families maximum.

If the project already contains suitable fonts, reuse them.

## BRAND

PRESERVE THE FRENZ AI BRAND.

Do NOT change:

- Frenz AI logo
- Logo proportions
- Brand identity
- Primary brand colors
- Product name
- Existing AI functionality
- Core navigation structure

The redesign is an evolution, not a rebrand.

## VISUAL LANGUAGE

The visual reference should be interpreted as:

LIGHTWEIGHT PREMIUM UI.

Not heavy glassmorphism.

Reduce:

- Blur
- Background blur
- Giant shadows
- Excessive gradients
- Glowing borders
- Excessive translucent cards
- Decorative effects
- Nested containers
- Unnecessary animations

Use:

- Clean backgrounds
- Subtle surface colors
- Thin borders
- Moderate corner radii
- Excellent spacing
- Strong typography
- Small purposeful gradients
- Subtle depth

The interface should feel almost effortless.

## LAGOS LIFE + SNAPCHAT INFLUENCE

Take inspiration from the interaction philosophy rather than copying either product.

Lagos Life:
- Lightweight
- Simple
- Friendly
- Strong typography
- Minimal UI chrome
- Fast-feeling
- Clear actions

Snapchat:
- Mobile-first
- Extremely easy to understand
- Visual
- Quick interactions
- Strong use of cards/content
- Simple navigation
- Playful but polished

Combine these with Frenz AI's premium AI identity.

DO NOT literally copy Snapchat UI.

## SHOWCASE / HERO CAROUSEL

The top showcase must automatically move to the next slide every 3 seconds.

Requirements:

- Auto-advance every 3 seconds.
- Smooth but lightweight transition.
- User can manually swipe/scroll.
- User can tap the showcase to interact.
- If the user manually interacts with the carousel, temporarily pause autoplay.
- Resume autoplay after a reasonable period of inactivity.
- If the showcase is focused/actively being interacted with, do not fight the user by automatically changing slides.
- Include simple pagination indicators.
- Do not use a heavy carousel library unless the project already has one.
- Prefer CSS scroll-snap + lightweight JavaScript if appropriate.
- Avoid continuously running expensive animations.

The carousel must be accessible.

Respect:

prefers-reduced-motion

When reduced motion is enabled:
- Disable or minimize transitions.
- Do not aggressively auto-animate.

## PERFORMANCE IS A HARD REQUIREMENT

The redesign must NOT make the application materially heavier.

Performance is more important than decorative effects.

Target:

FAST FIRST LOAD
FAST INTERACTION
LOW JAVASCRIPT
LOW IMAGE COST
LOW SERVER COST

Do not add unnecessary dependencies.

Before installing a package, ask:

"Can this be achieved with existing code or CSS?"

If yes, do that.

## VERCEL COST

Do not introduce architecture that unnecessarily increases Vercel usage.

Avoid:

- Excessive server functions
- Unnecessary server-side requests
- Repeated API calls
- Polling when it isn't required
- Infinite background processes
- Large server-rendered payloads
- Duplicate data fetching
- Unnecessary revalidation

Use caching where appropriate.

Do not turn simple UI state into server requests.

## RAILWAY COST

Do not increase Railway workload unnecessarily.

Avoid:

- Unnecessary backend polling
- Long-running requests caused by UI
- Repeated generation status requests
- Duplicate API calls
- Excessive database reads
- Unnecessary websocket connections

For generation progress:

Use an efficient strategy appropriate to the existing backend.

If polling already exists, inspect it first and optimize it rather than replacing it blindly.

## IMAGE PERFORMANCE

The interface contains many visual assets.

Do not simply add larger images.

Use:

- Responsive images
- Proper dimensions
- Modern formats where supported
- Lazy loading for below-the-fold images
- Priority loading only for the main hero
- Appropriate compression
- Thumbnail-sized assets where thumbnails are displayed

Do not load a 2000px image when a 400px thumbnail is needed.

## ANIMATION PERFORMANCE

Prefer:

CSS transforms
CSS opacity
CSS transitions

Avoid expensive:

filter-heavy animations
large blur animations
continuous box-shadow animation
layout-triggering animations
JavaScript animation loops

Animation should communicate interaction.

It should not exist simply because it looks impressive.

## WELCOME PAGE — PHASE 1

START HERE.

Do NOT redesign the other pages yet.

First inspect the existing welcome/onboarding page.

Then redesign it using the new design system.

The welcome page should establish the visual language that all future AI pages will follow.

It should feel:

- Premium
- Friendly
- Fast
- Modern
- Visual
- Lightweight
- Mobile-first

The user should understand what Frenz AI does almost immediately.

Keep the Frenz AI logo.

Keep the brand colors.

Use the new typography hierarchy.

Use the premium display font selectively for the main hero heading.

Do not overload the page with information.

## WELCOME PAGE STRUCTURE

Preserve existing functionality, but visually structure the page approximately as:

Logo / brand
↓
Hero message
↓
Short supporting explanation
↓
Primary CTA
↓
Secondary action if already supported
↓
Small visual/product showcase
↓
Trust/value information if already present

Do not add unnecessary sections just to fill space.

The first viewport should be extremely clear.

## BUTTON SYSTEM

Create a reusable button system.

PRIMARY:

Strong Frenz brand treatment.

Example:

[ ✨ Create with AI → ]

Characteristics:
- Medium height
- Comfortable touch target
- Moderate radius
- Clear typography
- Subtle gradient if appropriate
- No excessive glow

SECONDARY:

Simple.

Example:

[ Explore AI ]

or:

Learn more →

Do not turn every action into a pill.

## HOVER

Hover states should be subtle.

Button hover:
- Slight brightness change
- 1px upward movement
- Very subtle shadow
- Icon shifts slightly

Pressed:
- scale approximately 0.98
- fast transition

Cards:
- subtle border change
- 1–2px elevation
- no dramatic scaling

Navigation:
- clear active state
- brand accent
- subtle indicator

Do not use excessive animated gradients.

## MOBILE FIRST

The primary experience is mobile.

Design for:

iPhone
Android
small screens
large phones
tablet
desktop

Do not simply shrink desktop.

Pay attention to:

safe-area insets
touch targets
bottom navigation
viewport height
keyboard appearance
input focus
horizontal scrolling
carousel interaction

## INPUT / PROMPT SYSTEM

All future AI pages must eventually use a consistent input language.

Prompt areas should feel:

- spacious
- clean
- creative
- easy to understand

Do not make every input a giant glass card.

The prompt area should be one of the most visually important elements of the AI workflow.

## PROGRESS / GENERATION SYSTEM

Future generation pages must share the same design language.

Do not redesign loading states separately for every AI tool.

Create reusable:

GenerationProgress
GenerationStatus
GenerationError
GenerationComplete

components where appropriate.

The user should always understand:

What is happening
How long it may take
Whether the generation is still running
What they can do next

Avoid unnecessary real-time visual effects.

## AUDIO AND OTHER AI PAGES

When we reach those phases, keep the same:

Header
Typography
Buttons
Input language
Cards
Spacing
Navigation
Progress
Output states

But adapt the UI to the actual task.

For example:

Audio:
Prompt
Voice
Voice settings
Duration
Generate
Progress
Result

Image:
Prompt
Style
Aspect ratio
Reference
Generate
Progress
Result

Video:
Prompt
Style
Duration
Aspect ratio
Reference
Generate
Progress
Result

Do not force every page to look identical.

They should feel like the SAME PRODUCT, not cloned pages.

## DO NOT BREAK PERFORMANCE

Before and after each phase:

Check:

- bundle impact
- number of dependencies
- image weight
- client-side JavaScript
- API calls
- unnecessary renders
- console errors
- hydration issues
- mobile performance

Do not sacrifice performance for visual effects.

## IMPORTANT DEVELOPMENT WORKFLOW

For PHASE 1:

1. Inspect.
2. Explain what you found.
3. Identify the exact files to modify.
4. Implement only the welcome page.
5. Reuse/create shared design tokens only when necessary.
6. Run lint/typecheck/build.
7. Test responsive behavior.
8. Check existing functionality.
9. Check performance.
10. Stop.

Do NOT proceed to the next AI page automatically.

Wait for my approval.

After I approve Phase 1, we continue:

Phase 2 → Main AI Studio
then Phase 3 → Text to Video
then Phase 4 → Image to Video
etc.

## FINAL QUALITY BAR

The finished product should feel like:

"Frenz AI, but lighter, faster, cleaner and more premium."

It should have:

Lagos Life's restraint
+
Snapchat's effortless mobile interaction
+
Frenz AI's brand
+
premium AI-product quality

It must NOT feel:

- overly glassy
- bloated
- generic
- corporate
- over-animated
- visually noisy
- expensive to operate

When in doubt:

REMOVE complexity.

Do not add visual effects unless they improve usability or hierarchy.

START BY READING THE PROJECT.

DO NOT CODE YET.

After reading it, report your findings and the exact implementation plan for PHASE 1 — WELCOME PAGE ONLY.

---

# LEDGER

| Phase | State | Note |
|---|---|---|
| 1 — Welcome | 📋 **plan reported 2026-10-05, awaiting owner approval** | No code written |
| 2–16 | ⛔ not started | Owner: one phase at a time, stop after each |
