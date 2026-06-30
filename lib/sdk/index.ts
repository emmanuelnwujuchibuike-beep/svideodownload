/**
 * @frenzsave/sdk — the cross-platform client for the Frenzsave backend.
 *
 * One backend, four clients: import this from web, iOS, Android and desktop. The
 * folder is dependency-free and framework-free so it can be published to npm as
 * `@frenzsave/sdk` with no changes (see docs/API.md → "Shipping the SDK").
 *
 *   import { FrenzsaveClient } from "@/lib/sdk";        // web (this app)
 *   import { FrenzsaveClient } from "@frenzsave/sdk";   // native / desktop
 */
export { FrenzsaveClient, FrenzsaveError } from "./client";
export type { FrenzsaveClientOptions, TokenProvider } from "./client";
export type {
  ApiEnvelope,
  BillingPlan,
  ErrorCode,
  FeedItem,
  FeedPublisher,
  FeedResponse,
  FeedSort,
  MediaKind,
  MeResponse,
  Page,
  ResponseMeta,
} from "./types";
