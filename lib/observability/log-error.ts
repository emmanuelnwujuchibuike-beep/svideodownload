/**
 * The one real seam for wiring a production error-monitoring service
 * (Sentry or similar) in later — every error-boundary / global-capture call
 * site should route through this instead of calling `console.error`
 * directly, so that wiring touches one file, not each call site by hand.
 */
export function logError(label: string, error: unknown): void {
  console.error(label, error);
}
