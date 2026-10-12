import type { DeliveryRule, RuleGroup } from "@/lib/notifications/rules";
import { RULE_GROUP_LABEL } from "@/lib/notifications/rules";
import type { SmartCategory } from "@/lib/notifications/smart-category";

/**
 * SUGGESTED RULES (Feature 20 Part 5) — the brief's "AI suggestions", built as what
 * they honestly are: a counting rule over the member's OWN last 7 days, shown with
 * the number that triggered it. No model, no guess, nothing shared.
 *
 *   a group (not security, not messages) sent ≥ NOISY_WEEK notifications in 7 days
 *   and no rule already names it → "send these as an hourly summary?"
 *
 * Pure and tested (suggestions.test.ts). One tap applies it as an ordinary rule
 * the member can see, reorder and delete.
 */
export const NOISY_WEEK = 25;
const NEVER: readonly SmartCategory[] = ["security", "messages"];

export interface RuleSuggestion {
  group: RuleGroup;
  count: number;
  text: string;
  rule: Omit<DeliveryRule, "id">;
}

export function suggestRules(weekCounts: Partial<Record<SmartCategory, number>>, rules: readonly DeliveryRule[]): RuleSuggestion[] {
  const named = new Set(rules.map((r) => r.when.group));
  if (named.has("any")) return [];
  return (Object.entries(weekCounts) as [SmartCategory, number][])
    .filter(([g, n]) => n >= NOISY_WEEK && !NEVER.includes(g) && !named.has(g))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g, n]) => ({
      group: g,
      count: n,
      text: `${RULE_GROUP_LABEL[g]}: ${n} in the last 7 days. Get them as one hourly summary instead?`,
      rule: { when: { group: g, from: "anyone" }, then: "summary" },
    }));
}
