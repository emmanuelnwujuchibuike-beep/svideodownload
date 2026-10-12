/**
 * The words for an Attention Engine decision — the private "Why this?" on a member's own card.
 * Client-safe on purpose (no server imports), so the Activity Center can say it without a round trip.
 * Feature 20, lib/notifications/attention.ts makes the decisions.
 */
export type DeliveryDecision = "push" | "held" | "in_app";

const FOCUS_LABEL: Record<string, string> = {
  sleep: "Sleep",
  meeting: "Meeting",
  driving: "Driving",
  personal: "Personal time",
  vacation: "Vacation",
  work: "Work",
  study: "Study",
  gaming: "Gaming",
};

/** The hold, in words: "Sleep focus", "Do Not Disturb", "quiet hours". Null when it wasn't a hold. */
export function holdLabel(reasons: readonly string[]): string | null {
  for (const r of reasons) {
    if (r === "dnd") return "Do Not Disturb";
    if (r === "quiet_hours") return "quiet hours";
    if (r.startsWith("focus:")) return `${FOCUS_LABEL[r.slice(6)] ?? "a focus mode"} focus`;
  }
  return null;
}

/**
 * The private sentence on the member's own card ("Why this?"). `decision` null means no
 * decision was recorded (a row from before 0233, or a kind of update whose push isn't
 * tracked yet) — so it says only what is certain.
 */
export function explainDelivery(decision: DeliveryDecision | null, reasons: readonly string[]): string {
  if (!decision) return "Shown here in your Activity Center. Any push for it followed your notification settings.";
  const r = reasons[0] ?? "";
  if (decision === "held") return `Held from your lock screen because ${holdLabel(reasons) ?? "a hold"} was on. It waited here for you.`;
  if (decision === "in_app") {
    if (r === "burst_cap") return "Kept off your lock screen because you'd had a lot of notifications in the last hour.";
    if (r === "category_off") return "Kept off your lock screen because push is off for this category in your settings.";
    if (r === "push_off" || r === "master_off") return "Kept off your lock screen because push notifications are off in your settings.";
    return "Shown here only.";
  }
  if (r === "critical") return "Sent right away. Security and payment alerts always reach you, even in Do Not Disturb.";
  if (r === "favorite_through_quiet") return "Sent during quiet hours because it's from a favourite friend, as your settings allow.";
  if (r === "category_always") return "Sent during quiet hours because this category is set to always deliver.";
  if (r === "high_ignores_quiet") return "Sent right away. Messages and requests aren't held by quiet hours, only by Do Not Disturb or a focus mode.";
  return "Sent to your devices as a push.";
}
