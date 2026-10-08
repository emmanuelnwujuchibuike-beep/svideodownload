# Advertising Platform — Part 6 brief (owner, 2026-10-08)

Saved verbatim so it survives sessions. The owner added with it: "make sure
nothing comusumes vercel or railway money more than economy normal", and
earlier: "In part 6 don't duplicate what has already been built but instead
upgrade and modify it." The shared-slot rules (docs/AD_PLATFORM_PART5_SLOTS_ADDENDUM.md)
apply. Ledger at the end.

---

# PART 6 — ADVERTISER DASHBOARD + CAMPAIGN MANAGEMENT

You are working on Frenzsave's existing codebase. Implement **Part 6: Advertiser Dashboard and Campaign Management** of the self-service advertising platform.

## 1. START WITH A FULL AUDIT

Before changing anything, inspect the existing codebase and identify:

- Existing authentication and user roles.
- Ads database schema, campaigns, creatives, applications, and ad placements.
- Payment Router, payment ledger, Bachs.io, and Paystack integrations.
- Campaign validation and automatic activation.
- Existing physical advertising slots and provider-specific ad components.
- Supabase Storage, upload validation, analytics, notifications, and admin controls.
- Existing design system, shared components, routes, and mobile navigation.

Reuse existing implementations wherever possible. Do not create duplicate tables, payment systems, campaign engines, physical ad slots, or advertising providers when an equivalent already exists.

**Important:** This dashboard must use the canonical physical ad-slot inventory established in Part 1 and managed in Part 7. Advertisers select eligible placements, not internal ad providers. Do not create a new physical slot simply because a new campaign is created.

## 2. BUILD A PREMIUM ADVERTISER DASHBOARD

Create or upgrade the advertiser dashboard using Frenzsave's existing visual language.

Design requirements:
- Premium, modern, clean, and professional.
- White/light-gray backgrounds with restrained blue, indigo, and purple accents.
- Reuse existing Frenzsave components and typography.
- Responsive desktop and mobile layouts.
- Lightweight rendering and minimal animations.
- Clear loading, empty, success, error, and payment-verification states.
- Accessible controls and readable analytics.
- No unnecessary glass effects, excessive gradients, or decorative clutter.

The dashboard should contain:

1. Overview
2. Campaigns
3. Create Advertisement
4. Analytics
5. Payments and Billing
6. Advertising Rules and Help

Only show information and actions appropriate to the authenticated advertiser.

## 3. DASHBOARD OVERVIEW

Show useful summary cards, using actual database-backed data:

- Total campaigns.
- Live campaigns.
- Campaigns awaiting payment.
- Campaigns undergoing validation.
- Paused campaigns.
- Expired campaigns.
- Total impressions.
- Total clicks.
- Click-through rate (CTR).
- Advertising spend and payment history.

Do not invent statistics or display placeholder numbers as real data.

Use efficient aggregate queries or summary tables instead of fetching every campaign event to calculate dashboard totals.

Add a clear **Create Advertisement** action.

## 4. CAMPAIGN MANAGEMENT

Build a campaign list with search, filtering, sorting, and pagination.

Support these campaign statuses where applicable:

- Draft
- Ready for Payment
- Payment Processing
- Verifying Payment
- Validating
- Scheduled
- Live
- Editing
- Paused
- Expired
- Blocked
- Failed

Each campaign row or card should display:

- Campaign name.
- Creative preview or thumbnail.
- Ad format.
- Placement.
- Campaign status.
- Start and end dates.
- Remaining campaign duration.
- Impressions and clicks.
- CTR.
- Payment status.
- Available actions.

Allow the advertiser to open a detailed campaign page to view its creative, destination URL, configuration, performance, payment records, and available management actions.

Only expose actions permitted by the campaign's current state and the platform's policies.

## 5. CRITICAL REQUIREMENT — EDIT LIVE CAMPAIGNS

**Advertisers must be able to edit an existing live campaign without unnecessarily creating a new campaign or buying another physical ad slot.**

Where permitted by the campaign configuration, allow editing of:

- Image or video creative.
- Video thumbnail or poster.
- Destination URL.
- Headline.
- Description.
- Call-to-action text.
- Eligible placement or targeting, if the platform supports changing these fields safely.

The administrator may restrict editable fields through existing configuration.

### Safe live-edit workflow

When an advertiser edits a live campaign:

1. Keep the existing campaign ID.
2. Keep the existing payment record and original start date.
3. Preserve the original campaign end date unless a separately approved extension is purchased.
4. Keep the currently approved creative live while the replacement uploads and is validated.
5. Validate the replacement creative, destination URL, format, file size, duration, and applicable safety rules.
6. Replace the old creative only after the new creative passes validation.
7. Apply the change atomically so users never see a partially updated campaign.
8. If the replacement fails validation, keep the old approved creative live and display a clear error.
9. Record the change in an audit history.
10. Prevent concurrent edits from silently overwriting one another.

Use a lifecycle such as:

`LIVE → EDITING → VALIDATING → LIVE`

The current approved creative must remain available during the editing process unless an administrator or security system has explicitly disabled the campaign.

A creative replacement must not automatically reset campaign delivery, duplicate payment, restart the campaign duration, or create another physical advertising slot.

## 6. DESTINATION URL EDITING AND SAFETY

Allow destination URL changes only after server-side validation.

Requirements:
- Accept only supported URL schemes, normally HTTPS.
- Reject JavaScript URLs, embedded scripts, malformed URLs, and prohibited destinations.
- Apply the platform's redirect, phishing, malware, scam, and prohibited-content checks.
- Prevent unsafe server-side URL fetching and SSRF vulnerabilities.
- Revalidate the destination when it changes, even if the campaign was previously approved.
- Keep the previous valid destination active until the replacement passes validation.
- If a newly edited URL is flagged as dangerous, reject the edit and preserve the old URL unless the old destination itself has become unsafe.

Never trust client-side validation as the security boundary.

## 7. BILLABLE CHANGES AND CAMPAIGN EXTENSIONS

Distinguish between ordinary creative edits and changes that affect campaign pricing.

### Ordinary edits
Changing an image, video, headline, description, or destination URL should not automatically trigger a new payment unless an administrator-configured pricing rule explicitly requires it.

### Billable changes
If the advertiser changes the format, placement, duration, targeting, or another billable setting:

1. Recalculate the price on the server.
2. Compare the new price with the existing paid configuration.
3. Show the advertiser the price difference before payment.
4. Create a server-authoritative quote.
5. Require payment when the change incurs an additional charge.
6. Never silently charge the advertiser or promise an automatic refund.

### Campaign extensions
Allow advertisers to extend an existing campaign where supported.

- Generate a new extension quote.
- Link the extension payment to the existing campaign.
- Activate the extension only after payment verification.
- Preserve the original campaign ID and start date.
- Update the end date according to verified payment and the platform's extension rules.
- Prevent duplicate extensions from duplicate callbacks or webhooks.

Do not create a new campaign or physical slot merely to extend an existing campaign.

Expired campaigns should not be represented as live-editable campaigns. Allow the advertiser to create a new campaign or use an explicit renewal flow supported by the existing architecture.

Blocked campaigns must not be able to bypass restrictions by editing their creative or URL.

## 8. CREATIVE UPLOADS AND PREVIEWS

Reuse existing Supabase Storage and upload infrastructure.

Requirements:
- Upload directly to the appropriate storage location when safe.
- Validate file type, size, dimensions, and video duration.
- Enforce administrator-configured limits.
- Use thumbnails and lightweight previews.
- Avoid loading large videos unnecessarily.
- Keep the old creative available until the replacement is approved.
- Clean up abandoned uploads and obsolete assets safely.
- Do not delete media still referenced by a live campaign or required for audit purposes.

Previewing a campaign must not count as a real impression or click, trigger an actual advertisement, or alter campaign analytics.

## 9. ANALYTICS FOR ADVERTISERS

Provide campaign-level reporting for supported metrics:

- Impressions.
- Clicks.
- CTR.
- Performance over time.
- Campaign start and end dates.
- Creative performance, where applicable.
- Reward-video completion metrics, where applicable.
- Payment and campaign spend information.

Add sensible time filters, such as the last 7 days, last 30 days, and campaign lifetime, where supported.

Analytics must use the canonical physical slot and campaign attribution architecture. Do not double-count the same event because multiple providers or components are involved.

Separate self-serve campaign performance from external advertising-provider earnings. Advertisers must see only their own campaign information.

Do not expose internal fraud scores, private user information, raw IP addresses, or confidential platform-wide metrics to advertisers.

## 10. PAYMENTS AND BILLING

Reuse the existing Part 3 payment architecture and payment ledger.

Support:
- Campaign payment history.
- Payment amount and currency.
- Payment provider where appropriate.
- Payment reference.
- Payment status.
- Campaign or extension associated with the payment.
- Applied promotion and bonus duration, if applicable.
- Receipts or transaction details when supported.

Never trust the browser to confirm successful payment.

The authoritative flow is:

`Quote → Checkout → Provider Verification → Internal Payment Ledger → Campaign Activation or Extension`

Handle failed payments, pending payments, delayed webhooks, duplicate webhooks, retries, and refunds according to the existing payment architecture.

Do not create a second payment system specifically for this dashboard.

## 11. CAMPAIGN CONTROLS

Provide campaign pause/resume controls only if supported by the administrator's policies.

- A pause must stop eligible ad delivery through the shared serving engine.
- A resume must verify that the campaign remains valid, paid, within its dates, and eligible to run.
- Expired campaigns must not resume without a valid renewal or extension.
- Blocked campaigns cannot be resumed by advertisers.
- Advertiser controls must not override global ad shutdowns, provider failures, placement restrictions, or safety restrictions.

Reflect the actual server-confirmed status in the UI.

## 12. NOTIFICATIONS AND STATUS FEEDBACK

Reuse existing Frenzsave notifications where available.

Notify advertisers about relevant events such as:
- Payment verified.
- Campaign activated.
- Creative replacement approved or rejected.
- Campaign approaching expiration, if reminders are supported.
- Campaign expired.
- Campaign paused or blocked.
- Extension payment verified.
- Campaign validation failed.

Notifications must reflect server-confirmed events. Notification failure must not break campaign activation or payment processing.

## 13. SECURITY AND ACCESS CONTROL

Enforce authorization server-side and through Supabase Row Level Security where applicable.

- Advertisers can view and manage only campaigns they own or are explicitly authorized to manage.
- Validate ownership on every read, edit, upload, pause, resume, and extension request.
- Prevent IDOR vulnerabilities and unauthorized campaign-ID manipulation.
- Do not trust client-supplied prices, payment statuses, campaign statuses, ownership, duration, or validation results.
- Keep secrets and privileged service-role credentials server-side.
- Protect campaign updates against race conditions.
- Log sensitive changes and administrative interventions.

## 14. PERFORMANCE AND INFRASTRUCTURE COSTS

Frenzsave must remain lightweight and cost-efficient.

- Avoid fetching every campaign event for dashboard summaries.
- Use pagination and indexed queries.
- Use aggregate tables or summaries where appropriate.
- Avoid constant polling and unnecessary Supabase Realtime subscriptions.
- Do not load full-size creative videos into campaign lists.
- Lazy-load campaign details and charts.
- Reuse existing configuration and entitlement state.
- Avoid unnecessary Vercel function invocations and Railway CPU/memory usage.
- Use Supabase as the primary data layer where appropriate.
- Do not route large media files through application servers unnecessarily.
- Ensure the dashboard does not slow down Download, Frenz AI, Feed, Reels, or ad delivery.

## 15. TESTING AND ACCEPTANCE CRITERIA

Test at minimum:

1. Advertisers can see only their own campaigns.
2. A live campaign can replace its image or video without creating a duplicate campaign.
3. The old creative remains live until the replacement passes validation.
4. Invalid creative uploads are rejected safely.
5. Malicious destination URLs are rejected.
6. A failed replacement does not destroy the previous valid creative.
7. Ordinary edits do not trigger unintended charges.
8. Billable changes require a server-generated quote and appropriate payment.
9. Extensions preserve the campaign ID and original start date.
10. Duplicate payment webhooks do not grant duplicate extensions.
11. Paused, expired, blocked, and unpaid campaigns cannot bypass eligibility rules.
12. Analytics do not double-count events.
13. Previewing does not generate real impressions or clicks.
14. Mobile and desktop layouts work correctly.
15. Dashboard failures do not break the core Frenzsave product.

## 16. FINAL IMPLEMENTATION REPORT

After implementation, report:

- What existing systems were discovered and reused.
- What dashboard pages and components were added or updated.
- How live campaign editing works.
- How creative and URL validation work.
- How pricing changes and extensions work.
- Which database changes or migrations were required.
- Which security and performance improvements were made.
- Which tests were run and their actual results.
- Any incomplete functionality or remaining risks.

Do not claim a test passed unless it was actually run.

## NON-NEGOTIABLE RULES

- Audit before modifying.
- Reuse existing authentication, payments, storage, analytics, campaign infrastructure, and canonical physical ad slots.
- Do not duplicate campaigns or payments for ordinary live edits.
- Do not remove existing AdSense, ExoClick, Monetag, Hilltop, custom ads, or other discovered integrations.
- Never replace an approved live creative until its replacement passes validation.
- Never activate a campaign based solely on client-side payment confirmation.
- Keep advertiser controls separate from administrator and security controls.
- Preserve existing Frenzsave functionality.
- Prioritize correctness, security, performance, and low infrastructure cost over unnecessary rewrites.

**Part 6 is complete only when advertisers can securely manage campaigns, edit live ads, view performance, and manage payments without duplicating campaigns, payments, or physical ad inventory.**

---

## Ledger

| Item | State |
|---|---|
| Brief received | 2026-10-08 |
| §1 audit | done |
| Implementation | 2026-10-08 — report in docs/AD_PLATFORM.md "Part 6" |
| Analytics multiplier (owner request) | declined — advertisers see real counts |
