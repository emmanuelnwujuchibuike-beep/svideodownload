import { describe, expect, it } from "vitest";

import { checkAccent } from "@/lib/profile/color";
import { canEnableModule } from "@/lib/profile/engine";
import { modulesForType } from "@/lib/profile/modules";
import { LAYOUT_PRESETS, layoutPreset } from "@/lib/profile/presets";
import { profileType } from "@/lib/profile/profile-types";
import {
  FONT_SCALES,
  PROFILE_THEMES,
  profileTheme,
  RADII,
  resolveProfileTheme,
  SURFACES,
  type StoredAppearance,
} from "@/lib/profile/theme";

const EMPTY: StoredAppearance = { theme: null, surface: null, radius: null, fontScale: null, accent: null };

describe("theme registry", () => {
  it("has unique keys", () => {
    const keys = PROFILE_THEMES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every theme's own accent is usable on BOTH light and dark", () => {
    // The quality floor: a member picking a shipped theme must never end up
    // with an accent that is invisible to half their visitors.
    for (const t of PROFILE_THEMES) {
      const report = checkAccent(t.accent);
      expect(report, `${t.key} has an unparseable accent`).not.toBeNull();
      expect(report!.usableAsAccent, `${t.key} accent ${t.accent} fails contrast`).toBe(true);
    }
  });

  it("every theme names a real surface and radius", () => {
    const surfaces = new Set(SURFACES.map((s) => s.key));
    const radii = new Set(RADII.map((r) => r.key));
    for (const t of PROFILE_THEMES) {
      expect(surfaces.has(t.surface), `${t.key}`).toBe(true);
      expect(radii.has(t.radius), `${t.key}`).toBe(true);
    }
  });

  it("falls back to the default for unknown or missing keys", () => {
    expect(profileTheme(null).key).toBe("classic");
    expect(profileTheme("chartreuse-deluxe").key).toBe("classic");
  });
});

describe("resolveProfileTheme", () => {
  it("emits every variable the profile wrapper needs", () => {
    const { vars } = resolveProfileTheme(EMPTY);
    for (const key of [
      "--frenz-profile-accent",
      "--frenz-profile-wash-from",
      "--frenz-profile-wash-to",
      "--frenz-profile-radius",
      "--frenz-profile-font-scale",
      "--frenz-profile-card-bg",
      "--frenz-profile-card-border",
      "--frenz-profile-card-shadow",
      "--frenz-profile-card-blur",
    ]) {
      expect(vars[key], `missing ${key}`).toBeTruthy();
    }
  });

  it("lets the member's own choices override the theme's defaults", () => {
    const out = resolveProfileTheme({ ...EMPTY, theme: "classic", surface: "glass", radius: "pill", fontScale: "large" });
    expect(out.surface).toBe("glass");
    expect(out.radius).toBe("pill");
    expect(out.fontScale).toBe("large");
  });

  it("ignores unknown stored values rather than breaking the profile", () => {
    // A row written by a newer version, or hand-edited, must still render.
    const out = resolveProfileTheme({ theme: "??", surface: "??", radius: "??", fontScale: "??", accent: "??" });
    expect(out.spec.key).toBe("classic");
    expect(out.vars["--frenz-profile-radius"]).toBeTruthy();
  });

  it("CORRECTS an inaccessible accent rather than rendering it", () => {
    const out = resolveProfileTheme({ ...EMPTY, accent: "#fff8b0" });
    expect(out.accentCorrected).toBe(true);
    expect(checkAccent(out.accent)!.usableAsAccent).toBe(true);
  });

  it("leaves a good accent exactly as chosen", () => {
    const out = resolveProfileTheme({ ...EMPTY, accent: "#6C4DFF" });
    expect(out.accentCorrected).toBe(false);
    expect(out.accent.toLowerCase()).toBe("#6c4dff");
  });

  it("only the glass surface pays for backdrop blur", () => {
    // It is the most expensive property here and creates a containing block
    // that breaks position:fixed descendants — one opt-in surface, not four.
    for (const s of SURFACES) {
      const out = resolveProfileTheme({ ...EMPTY, surface: s.key });
      const blur = out.vars["--frenz-profile-card-blur"];
      if (s.key === "glass") expect(blur).toContain("blur");
      else expect(blur, `${s.key} should not blur`).toBe("none");
    }
  });

  it("keeps the type scale within readable bounds", () => {
    for (const f of FONT_SCALES) {
      expect(f.scale).toBeGreaterThanOrEqual(0.9);
      expect(f.scale).toBeLessThanOrEqual(1.2);
    }
  });

  it("is deterministic — the same input always renders the same", () => {
    const input: StoredAppearance = { theme: "ocean", surface: "glass", radius: "soft", fontScale: "compact", accent: "#0891B2" };
    expect(resolveProfileTheme(input).vars).toEqual(resolveProfileTheme(input).vars);
  });
});

describe("layout presets", () => {
  it("has unique keys and resolves each", () => {
    const keys = LAYOUT_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of LAYOUT_PRESETS) expect(layoutPreset(p.key)).toBeDefined();
  });

  it("every preset only enables modules its own profile type offers", () => {
    // The guard that stops a preset applying a layout that half-renders.
    for (const p of LAYOUT_PRESETS) {
      for (const m of p.modules) {
        expect(canEnableModule(p.type, m), `preset "${p.key}" enables ${m}, which a ${p.type} profile can't show`).toBe(true);
      }
    }
  });

  it("every preset enables at least one module, and lands on a real one", () => {
    for (const p of LAYOUT_PRESETS) {
      expect(p.modules.length, p.key).toBeGreaterThan(0);
      const offered = new Set(modulesForType(p.type).map((m) => m.key));
      expect(offered.has(p.modules[0]!), `${p.key} lands on ${p.modules[0]}`).toBe(true);
    }
  });

  it("every preset names a real type and theme", () => {
    for (const p of LAYOUT_PRESETS) {
      expect(profileType(p.type).key).toBe(p.type);
      expect(profileTheme(p.theme).key).toBe(p.theme);
    }
  });

  it("no preset lists the same module twice", () => {
    for (const p of LAYOUT_PRESETS) {
      expect(new Set(p.modules).size, p.key).toBe(p.modules.length);
    }
  });
});
