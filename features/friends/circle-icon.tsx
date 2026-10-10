import { Briefcase, Circle, Compass, Crown, Diamond, Hexagon, Layers, Ribbon, Shield, Star, type LucideIcon } from "lucide-react";

import { isCircleIcon, type CircleIcon } from "@/lib/social/graph/circles";

/**
 * A circle's glyph (Feature 19 · Part 4: "Do NOT use emoji icons" — geometric,
 * monochrome symbols). The stored value is a CIRCLE_ICONS key; this is the only
 * place it becomes an icon, and an unknown key falls back to the plain circle.
 */
const GLYPHS: Record<CircleIcon, LucideIcon> = {
  circle: Circle,
  diamond: Diamond,
  shield: Shield,
  compass: Compass,
  star: Star,
  hexagon: Hexagon,
  ribbon: Ribbon,
  layers: Layers,
  crown: Crown,
  briefcase: Briefcase,
};

export function CircleGlyph({ icon, className }: { icon: string; className?: string }) {
  const Glyph = GLYPHS[isCircleIcon(icon) ? icon : "circle"];
  return <Glyph className={className} strokeWidth={2} aria-hidden />;
}
