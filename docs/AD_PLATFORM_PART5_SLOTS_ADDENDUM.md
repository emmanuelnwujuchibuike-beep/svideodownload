# Advertising Platform — Part 5 addendum: shared ad slots (owner, 2026-10-08)

Saved verbatim (headings converted to Markdown) so it survives sessions. It
arrived while Part 5 was being verified and governs the whole of Part 5.
Implementation ledger: docs/AD_PLATFORM.md, "Part 5".

---

## 48. SHARED AD SLOT ARCHITECTURE — NON-NEGOTIABLE

DO NOT create duplicate physical ad locations for Frenzsave Ads.

Frenzsave already has advertising slots/placements configured for external advertising providers such as:

- Google AdSense
- ExoClick

The new Frenzsave self-serve advertising system MUST reuse those existing physical ad slots wherever the placement is compatible.

The architecture must have ONE canonical ad-slot/placement definition.

Example:

Existing physical slot:

TOP_BANNER
32px below header

That same physical location can serve:

- Google AdSense
- ExoClick
- Frenzsave Self-Serve Ads

Do NOT create:

Top Banner A → AdSense
Top Banner B → ExoClick
Top Banner C → Frenzsave Ads

That would create duplicate advertising spaces and damage the UI.

Instead:

ONE physical slot
        ↓
Ad Provider / Campaign Selection
        ↓
AdSense OR ExoClick OR Frenzsave Advertiser

## 49. EXISTING SLOT INVENTORY AUDIT

Before implementing the new ad-serving layer, inspect the existing codebase and identify every existing advertising slot/placement currently used by:

- Google AdSense
- ExoClick
- any other existing advertising provider

Map each existing slot to:

- slot ID
- placement
- page
- format
- dimensions
- location in UI
- provider
- current component
- current loading behavior
- current fallback behavior

Do NOT create a new slot if an existing compatible slot already exists.

Create a canonical shared slot registry if one does not already exist.

## 50. CANONICAL AD SLOT REGISTRY

Create/reuse one shared concept such as:

AdSlot

or:

AdPlacementSlot

The exact implementation must follow the existing codebase.

Each physical advertising location should have ONE stable identity.

Example:

slot_id:
global_top_banner

placement:
GLOBAL_TOP_BANNER

location:
below_header

dimensions:
32px height

supported providers:
- adsense
- exoclick
- frenzsave

The provider should be selected independently from the physical slot.

## 51. PROVIDER-AGNOSTIC AD SLOT

Separate:

PHYSICAL SLOT

from:

AD PROVIDER.

Conceptually:

AdSlot
  ↓
Provider Selection
  ├── Google AdSense
  ├── ExoClick
  └── Frenzsave Self-Serve

The UI should render ONE slot.

The slot decides which provider/advertisement should occupy it.

Never render two provider components in the same physical location simultaneously.

## 52. PROVIDER FALLBACK

If a slot supports multiple providers, implement a controlled priority/fallback strategy.

Example:

1. Frenzsave paid campaign eligible?
   → serve Frenzsave campaign

2. Otherwise AdSense eligible?
   → serve AdSense

3. Otherwise ExoClick eligible?
   → serve ExoClick

4. Otherwise:
   → render nothing

However, DO NOT hard-code this priority.

The provider priority should be configurable where appropriate.

The architecture must support:

- provider priority
- provider availability
- slot compatibility
- campaign eligibility
- global provider disable
- page/placement rules

## 53. NO DUPLICATE SPOTS

This is a critical requirement.

If an existing page currently has:

[AdSense slot]

do NOT add:

[Frenzsave ad slot]

directly above, below, beside, or inside it simply because Frenzsave Ads has been implemented.

Instead, convert the existing physical location into the shared slot.

The page should continue to contain ONE advertising location.

## 54. SHARED SLOT DIMENSIONS

The physical slot's dimensions should be defined by the canonical slot, not independently by each provider.

For example:

GLOBAL_TOP_BANNER
→ 32px

CONTENT_BANNER
→ 320×200

DOWNLOAD_RESULT_BANNER
→ 320×200

If AdSense, ExoClick or Frenzsave Self-Serve uses that location, they must respect the slot's layout constraints.

Do not allow one provider to unexpectedly create layout shifts that change the page structure.

## 55. SLOT COMPATIBILITY

Each provider/creative must be checked against the physical slot.

For example:

slot:
320×200

eligible creative:
320×200 image

→ compatible

But:

creative:
1080×1920 story video

→ not compatible

Do not force incompatible advertising formats into an existing slot.

## 56. ADSENSE + EXOCLICK MUST REMAIN FUNCTIONAL

Do not break the existing:

- AdSense integration
- ExoClick integration
- ad configuration
- provider scripts
- provider-specific identifiers
- existing monetization logic

Audit them first.

If they already have a slot/component abstraction, integrate the Frenzsave self-serve provider into that architecture rather than replacing it.

## 57. PROVIDER ADAPTER ARCHITECTURE

If appropriate for the existing codebase, create a shared abstraction such as:

AdProvider

with implementations such as:

- AdsenseProvider
- ExoClickProvider
- FrenzsaveProvider

The exact naming should follow the existing architecture.

The shared slot should not need to know unnecessary provider-specific implementation details.

Conceptually:

SharedAdSlot
    ↓
AdProviderResolver
    ↓
AdsenseProvider
OR
ExoClickProvider
OR
FrenzsaveProvider

## 58. FRENZSAVE CAMPAIGN ROTATION

The existing 10-slot Frenzsave rotation should represent:

10 eligible Frenzsave campaigns/creatives

NOT:

10 additional physical ad locations.

For example:

ONE physical top banner slot

can locally rotate:

Frenzsave Campaign A
→ Campaign B
→ Campaign C
→ Campaign D

etc.

The 5-second rotation changes the creative occupying the SAME physical slot.

It does NOT create additional page elements.

## 59. SHARED SLOT + EXTERNAL PROVIDER SAFETY

Be careful with third-party advertising providers.

Do not simultaneously load:

AdSense
+
ExoClick
+
Frenzsave

inside the same physical slot.

Only the selected provider should occupy the slot at a given time.

Do not initialize third-party provider scripts unnecessarily when that provider is not going to be used.

Follow each provider's policies and technical requirements.

## 60. ADMIN SLOT MANAGEMENT

Admin should see the canonical physical advertising slots.

For each slot, Admin should be able to see/configure:

- slot ID
- placement
- page
- dimensions
- enabled/disabled
- supported providers
- provider priority
- Frenzsave self-serve availability
- AdSense availability
- ExoClick availability

Do not create separate physical slots for each provider.

Admin is configuring:

"Who is allowed to occupy this location?"

not:

"Create another location."

## 61. SLOT MIGRATION

If the existing Frenzsave code has separate AdSense and ExoClick components occupying what is actually the same visual location, do NOT blindly preserve both.

Audit the UI and consolidate them into one canonical physical slot where appropriate.

Preserve provider-specific configuration while removing duplicate rendering.

Do this carefully so existing monetization is not broken.

## 62. PERFORMANCE

The shared slot system must reduce—not increase—resource usage.

Do not initialize all providers simultaneously.

Do not load:

AdSense + ExoClick + Frenzsave media

just to determine which one will display.

Use the cheapest/lightest provider-selection mechanism possible before loading heavy provider resources.

Avoid:

- duplicate provider scripts
- duplicate slot initialization
- duplicate impressions
- duplicate network requests
- duplicate DOM containers
- duplicate analytics events

## 63. FINAL SLOT AUDIT

Before finishing, produce a table:

Physical Slot
| Existing Provider
| Existing Location
| Frenzsave Provider
| Shared?
| Duplicate Removed?
| Dimensions

Verify that every advertising location on:

- Landing
- Download
- Download Result
- Feed
- Reels
- AI
- AI Reels
- Stories
- Interstitial

uses the appropriate canonical slot.

The final UI must NOT contain duplicate advertising spaces merely because Frenzsave Self-Serve Ads was added.

CORE PRINCIPLE:

ONE PHYSICAL AD LOCATION
        ↓
MULTIPLE POSSIBLE PROVIDERS
        ↓
ONE PROVIDER/ADVERTISEMENT SERVED AT A TIME

Never create a second advertising spot when an existing compatible AdSense/ExoClick slot already exists.

---

# SHARED EXISTING AD SLOT SYSTEM — NON-NEGOTIABLE

DO NOT create duplicate physical advertising slots.

Before creating ANY new Frenzsave Self-Serve advertising slot, perform a complete codebase audit and discover EVERY existing advertising slot, advertising container, advertising placeholder, ad component, ad placement, and monetization location already implemented anywhere in Frenzsave.

This is NOT limited to:

- Google AdSense
- ExoClick

It includes EVERY advertising/monetization provider and EVERY existing advertising location found in the codebase.

Examples may include:

- Google AdSense
- ExoClick
- Monetag
- Hilltop
- custom/internal ads
- self-serve ads already implemented
- banner containers
- interstitial containers
- rewarded-video containers
- download-completion ads
- AI reward ads
- feed/reels ad containers
- story ad containers
- placeholder ad components
- legacy ad components
- provider-specific ad wrappers
- ad slot IDs
- ad placement IDs
- reusable ad components
- monetization placeholders
- any other advertising infrastructure already present

The codebase itself is the source of truth for discovering existing slots.

## 1. FULL CODEBASE AD-SLOT AUDIT

Before implementing Part 5, search the ENTIRE codebase for existing advertising infrastructure.

Search for:

- ad
- ads
- advertisement
- advertising
- banner
- interstitial
- rewarded
- reward
- monetization
- placement
- slot
- adSlot
- slotId
- adsense
- exoclick
- monetag
- hilltop
- VAST
- video ad
- reward video
- ad container
- ad placeholder
- campaign
- publisher
- creative
- sponsor
- promotion

Also inspect:

- components
- pages
- routes
- layouts
- hooks
- utilities
- services
- API routes
- server functions
- Supabase queries
- configuration files
- environment variables
- provider integrations
- admin configuration
- mobile/PWA-specific components

Do not assume that an existing slot is named "ad".

Some advertising locations may be represented by generic containers or components.

## 2. BUILD AN EXISTING SLOT INVENTORY

Create an inventory of every existing physical advertising location.

For each discovered location record:

- existing component
- route/page
- physical position
- dimensions
- format
- provider
- provider identifier
- slot identifier if available
- loading behavior
- current fallback behavior
- whether it is active
- whether it is provider-specific
- whether it can support Frenzsave Self-Serve Ads
- whether it overlaps another existing slot

Example:

| Physical Location | Existing Component | Provider | Format | Dimensions |
|-------------------|--------------------|----------|--------|------------|
| Below Header | ExistingBanner | AdSense | Banner | 32px |
| Download Result | ExistingAd | ExoClick | Banner | 320×200 |
| AI Save | ExistingReward | VAST | Reward Video | Video |
| Feed Item | ExistingAdContainer | Monetag | Native | Configured |

The actual inventory MUST come from the codebase.

Do not invent entries.

## 3. ONE CANONICAL PHYSICAL SLOT

Every physical advertising location must have ONE canonical slot identity.

For example:

GLOBAL_TOP_BANNER

DOWNLOAD_RESULT_BANNER

AI_SAVE_REWARD

FEED_INLINE_1

etc.

The exact names must be based on the actual codebase.

A physical location must NOT become:

AdSense Slot
+
ExoClick Slot
+
Monetag Slot
+
Frenzsave Slot

if they all represent the same physical location.

Instead:

ONE PHYSICAL SLOT
        ↓
AVAILABLE PROVIDERS
        ↓
ONE PROVIDER SELECTED
        ↓
ONE AD RENDERED

## 4. ALL EXISTING PROVIDERS

The shared slot architecture must be provider-agnostic.

Any existing provider discovered in the codebase must be treated as a possible provider of the shared slot.

Examples:

- AdSense
- ExoClick
- Monetag
- Hilltop
- internal Frenzsave ads
- self-serve advertiser campaigns
- future advertising providers

Do not hard-code the architecture around two providers.

The system must remain extensible.

## 5. DO NOT DELETE EXISTING MONETIZATION

Do NOT remove an existing advertising integration simply because Frenzsave Self-Serve Ads is being added.

Existing provider integrations must continue working unless the audit shows that two implementations are actually duplicate renderings of the same physical slot.

If consolidation is necessary:

- preserve provider configuration
- preserve provider IDs
- preserve monetization logic
- preserve compliance requirements
- preserve existing analytics where appropriate
- migrate carefully
- test before removing duplicate rendering

## 6. SELF-SERVE ADS MUST REUSE EXISTING INVENTORY

Frenzsave Self-Serve Ads should consume available physical advertising inventory already present in the application whenever compatible.

Do NOT automatically add a new advertising location just because the Self-Serve Ads system has a new format.

First ask:

"Does a compatible physical advertising slot already exist?"

If YES:
→ reuse it.

If NO:
→ only then create a new physical slot.

Any genuinely new slot must be explicitly documented as a new inventory location.

## 7. NEW SLOT CREATION RULE

A new physical ad slot may only be created when:

1. No existing compatible slot exists.
2. The new placement is actually required by the Frenzsave product.
3. It does not duplicate an existing location.
4. It is compatible with the existing page UX.
5. It is added to the canonical slot registry.
6. It is available to the Admin advertising system.
7. It is documented in the final implementation report.

Do not create new slots merely because the new Ads Engine has a new database format.

## 8. PROVIDER ≠ SLOT

This distinction is critical.

A provider is:

"Who supplies the advertisement?"

A slot is:

"Where does the advertisement appear?"

For example:

Physical slot:
TOP_BANNER

Possible providers:
- AdSense
- ExoClick
- Monetag
- Hilltop
- Frenzsave Self-Serve

These are NOT five physical slots.

They are five possible providers for ONE physical slot.

## 9. FORMAT ≠ SLOT

Do not confuse:

- ad format
- provider
- creative
- campaign
- physical placement

For example:

REWARD_VIDEO

is an ad format.

AI_VIDEO_SAVE

may be the physical placement.

A particular advertiser campaign is the campaign.

The uploaded video is the creative.

AdSense/ExoClick/Monetag/etc. are providers.

Keep these concepts separate.

## 10. SHARED SLOT RESOLUTION

Create/reuse a central resolver conceptually similar to:

resolveAdSlot({
  slotId,
  page,
  placement,
  format,
  userContext
})

It should determine which provider/campaign should occupy the physical slot.

Conceptually:

Physical Slot
      ↓
Is Self-Serve Campaign Eligible?
      ↓
YES → Frenzsave Campaign
NO
      ↓
Is Existing Provider Eligible?
      ↓
YES → Existing Provider
NO
      ↓
No Advertisement

The exact priority must be configurable and compatible with the existing monetization architecture.

Do not hard-code one provider as universally highest priority.

## 11. DO NOT LOAD EVERY PROVIDER

Do NOT initialize every advertising provider simply because a physical slot exists.

For example, do not automatically load:

AdSense
+
ExoClick
+
Monetag
+
Hilltop
+
Frenzsave

into the same page just to decide which one gets displayed.

Resolve the provider first where technically possible, then initialize only the provider required for that slot.

Follow each provider's technical and policy requirements.

## 12. NO DUPLICATE DOM LOCATIONS

There must only be ONE physical ad container for a shared slot.

Bad:

<div>
  AdSense
</div>

<div>
  Frenzsave Ad
</div>

when both represent the same top-banner location.

Correct:

<div data-ad-slot="global_top_banner">
   selected provider
</div>

The provider rendered inside the slot can change without creating another physical location.

## 13. EXISTING SLOT DIMENSIONS ARE AUTHORITATIVE

When an existing physical slot is reused, preserve its established dimensions and layout behavior unless the Admin/system explicitly changes the canonical slot specification.

Do not create a second 320×200 area because Frenzsave Self-Serve requires 320×200.

If a compatible 320×200 slot already exists:

REUSE IT.

## 14. MAP OLD SLOTS TO THE NEW ADS ENGINE

Where appropriate, map existing physical slots into the new Ads Engine:

Existing slot
      ↓
Canonical slot ID
      ↓
Supported formats
      ↓
Supported providers
      ↓
Serving rules

Do not rebuild existing provider integrations just to make them fit.

Create adapters around them where necessary.

## 15. LEGACY / DUPLICATE SLOT DETECTION

During the audit, identify:

- duplicate slot components
- duplicate ad containers
- obsolete providers
- unused ad components
- two components rendering ads in the same location
- multiple provider scripts initialized for one slot
- legacy slot IDs
- duplicated analytics

Do not automatically delete them.

First determine whether they are:

A. Active and required
B. Active but duplicate
C. Legacy but referenced
D. Unused
E. Broken
F. Provider-specific
G. Shared physical inventory

Then safely consolidate where appropriate.

## 16. ADMIN DASHBOARD

Admin should manage the canonical physical inventory rather than creating provider-specific duplicate spots.

For each slot show:

- Slot ID
- Page
- Placement
- Dimensions
- Format
- Current provider
- Supported providers
- Frenzsave Self-Serve enabled/disabled
- Existing provider enabled/disabled
- Priority/fallback configuration
- Status

This allows Admin to decide who can occupy existing inventory.

## 17. SELF-SERVE CAMPAIGN APPLICATION

When an advertiser selects a placement, the application should reference the canonical physical inventory.

Do not present duplicate choices such as:

"Top Banner — AdSense"

"Top Banner — ExoClick"

"Top Banner — Frenzsave"

unless these genuinely represent different physical inventory.

Advertisers should generally see the actual Frenzsave advertising placement, not internal provider implementation details.

## 18. ANALYTICS

Analytics must distinguish:

physical slot

from:

provider

from:

campaign

from:

creative.

Example:

slot:
GLOBAL_TOP_BANNER

provider:
Frenzsave Self-Serve

campaign:
Campaign 123

creative:
Creative 456

This allows Admin to understand total inventory performance without double-counting the physical location.

## 19. PERFORMANCE

Consolidating slots must REDUCE infrastructure usage.

Do not introduce:

- duplicate API requests
- duplicate provider initialization
- duplicate media loading
- duplicate analytics
- duplicate DOM
- duplicate observers
- duplicate timers

A shared slot should be cheaper than maintaining separate provider components.

## 20. FINAL CODEBASE AUDIT

Before finishing, produce a complete inventory of all advertising slots found in the codebase.

For each:

- existing location
- component
- provider
- format
- dimensions
- canonical slot ID
- reused by Self-Serve Ads?
- duplicate found?
- action taken

Then explicitly state:

TOTAL EXISTING PHYSICAL AD SLOTS DISCOVERED: X

TOTAL CANONICAL SLOTS AFTER CONSOLIDATION: X

NEW PHYSICAL SLOTS CREATED: X

DUPLICATE PHYSICAL SLOTS REMOVED/CONSOLIDATED: X

No new slot should be created simply because the Frenzsave Self-Serve advertising system was introduced.

CORE RULE:

AUDIT EVERYTHING FIRST.

REUSE EVERY COMPATIBLE EXISTING PHYSICAL AD SLOT.

ONLY CREATE A NEW PHYSICAL SLOT WHEN THE CODEBASE PROVES THAT NO COMPATIBLE SLOT ALREADY EXISTS AND THE PRODUCT ACTUALLY REQUIRES ONE.

ONE PHYSICAL SLOT ≠ ONE PROVIDER.

ONE PHYSICAL SLOT CAN HAVE MULTIPLE POSSIBLE PROVIDERS.
