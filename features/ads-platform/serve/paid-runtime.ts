"use client";

/**
 * The paid-ad ENGINE as one lazily-loaded chunk.
 *
 * The slot hooks (useSlotProvider, useSelfAdPool) live on every ad-carrying
 * page, including the landing with its hard cold-entry budget, so they import
 * only the shared inventory check and the lean slot registry. Everything here —
 * the payload client, eligibility, the pool, rotation history — is fetched
 * ONLY after the inventory says a paid campaign is live (`self: true`). With no
 * campaign, not one byte of it is downloaded.
 */

export { loadSelfAds } from "../serving-client";
export { creativeFitsSlot } from "@/lib/ads-platform/slot-registry";
export { mayShowAgain, nextFromPool, onCreativeFailed, poolFor, recordShown } from "@/lib/ads-platform/serving-state";
