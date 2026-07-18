/**
 * The Frenzsave module registry — the single source of truth for every product in
 * the ecosystem. To add a product, add ONE entry to `MODULES`. The app shell, RBAC
 * gating, the app launcher, and search all read from here.
 *
 * Keep this list static (a plain array, not a mutable Map populated by import
 * side-effects) so it is deterministic, tree-shake-friendly, and safe on the server.
 *
 * See `docs/ARCHITECTURE.md` → "Adding a new product".
 */
import { Cloud, Compass, Download, Home, Shield, Sparkles, Users, Wand2 } from "lucide-react";

import {
  adminOnly,
  everyone,
  type ModuleAccess,
  type PlatformModule,
  proOnly,
} from "@/lib/platform/module-registry";

export const MODULES: PlatformModule[] = [
  {
    id: "download",
    name: "Frenzsave Download",
    shortName: "Download",
    tagline: "Save video & audio from 20+ platforms.",
    basePath: "/downloads",
    icon: Download,
    accent: "from-blue-600 to-violet-600",
    status: "live",
    veracity: {
      stage: "live",
      claimable: true,
      provingRoute: "/downloads",
      evidence: "app/(app)/downloads — extraction pipeline live via /api/download",
      verifiedAt: "2026-07-18",
    },
    canAccess: everyone,
    nav: [{ label: "Download", href: "/downloads", icon: Download }],
  },
  {
    id: "community",
    name: "Frenzsave Community",
    shortName: "Community",
    tagline: "Stories, reels and your feed.",
    basePath: "/home",
    icon: Users,
    accent: "from-fuchsia-500 to-violet-600",
    status: "live",
    veracity: {
      stage: "live",
      claimable: true,
      provingRoute: "/home",
      evidence: "app/(app)/home — feed, reels, stories, messaging all shipped",
      verifiedAt: "2026-07-18",
    },
    canAccess: everyone,
    nav: [
      { label: "Home", href: "/home", icon: Home },
      { label: "Explore", href: "/explore", icon: Compass },
    ],
  },
  {
    id: "studio",
    name: "Frenzsave Studio",
    shortName: "Studio",
    tagline: "Edit, trim and remix what you capture.",
    basePath: "/studio",
    icon: Wand2,
    accent: "from-amber-500 to-orange-600",
    status: "soon",
    veracity: {
      // No `/studio` route exists. Copy must stay future-tense until one does.
      stage: "concept",
      claimable: false,
      verifiedAt: "2026-07-18",
    },
    canAccess: proOnly,
  },
  {
    id: "cloud",
    name: "Frenzsave Cloud",
    shortName: "Cloud",
    tagline: "Your library, synced across every device.",
    basePath: "/cloud",
    icon: Cloud,
    accent: "from-cyan-500 to-blue-600",
    status: "soon",
    veracity: {
      // No `/cloud` route exists. Copy must stay future-tense until one does.
      stage: "concept",
      claimable: false,
      verifiedAt: "2026-07-18",
    },
    canAccess: everyone,
  },
  {
    // Brand rule: never "AI" in product naming — this is the "Smart" suite.
    id: "smart",
    name: "Frenzsave Smart",
    shortName: "Smart",
    tagline: "Summaries, captions and smart search.",
    basePath: "/smart",
    icon: Sparkles,
    accent: "from-violet-500 to-indigo-600",
    status: "beta",
    veracity: {
      /*
       * `status: "beta"` overstates this. The backend exists (`app/api/assistant`),
       * but there is no `/smart` route and the only UI surface — `<AssistantWidget />`
       * — is commented out of `app/layout.tsx` ("temporarily removed"). Nothing is
       * user-reachable, so nothing may be claimed. Flip to `beta`/claimable when the
       * widget is re-mounted or a `/smart` destination ships.
       */
      stage: "internal",
      claimable: false,
      evidence: "backend only: app/api/assistant/route.ts; widget unmounted",
      verifiedAt: "2026-07-18",
    },
    canAccess: everyone,
  },
  {
    id: "admin",
    name: "Frenzsave Admin",
    shortName: "Admin",
    tagline: "Operate the platform.",
    basePath: "/admin",
    icon: Shield,
    accent: "from-slate-600 to-slate-800",
    status: "live",
    veracity: {
      stage: "live",
      claimable: false, // Real, but internal — never surfaced in marketing.
      provingRoute: "/admin",
      evidence: "app/admin",
      verifiedAt: "2026-07-18",
    },
    canAccess: adminOnly,
    nav: [{ label: "Admin", href: "/admin", icon: Shield }],
  },
];

/* --------------------------------- queries --------------------------------- */

/** All registered modules, in declaration order. */
export function getModules(): PlatformModule[] {
  return MODULES;
}

/** A module by its stable id, or undefined. */
export function getModule(id: string): PlatformModule | undefined {
  return MODULES.find((m) => m.id === id);
}

/** Modules the given visitor is allowed to open (use for nav, launcher, search). */
export function getModulesFor(access: ModuleAccess): PlatformModule[] {
  return MODULES.filter((m) => m.canAccess(access));
}

/** The module that owns a given pathname, by longest basePath match. */
export function resolveModule(pathname: string): PlatformModule | undefined {
  return MODULES.filter((m) => pathname === m.basePath || pathname.startsWith(`${m.basePath}/`)).sort(
    (a, b) => b.basePath.length - a.basePath.length,
  )[0];
}

/** Nav entries contributed by every module the visitor can access. */
export function getModuleNav(access: ModuleAccess) {
  return getModulesFor(access).flatMap((m) => m.nav ?? []);
}
