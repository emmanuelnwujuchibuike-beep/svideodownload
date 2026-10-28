import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1280px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        gold: {
          DEFAULT: "hsl(var(--gold))",
          foreground: "hsl(var(--gold-foreground))",
        },
        // The Frenz screen palette (design/*.dc.html) — values in lib/platform/design-tokens.ts FRENZ_TOKENS.
        frenz: {
          blue: "hsl(var(--frenz-blue) / <alpha-value>)",
          violet: "hsl(var(--frenz-violet) / <alpha-value>)",
          magenta: "hsl(var(--frenz-magenta) / <alpha-value>)",
          ink: "hsl(var(--frenz-ink) / <alpha-value>)",
          muted: "hsl(var(--frenz-muted) / <alpha-value>)",
          page: "hsl(var(--frenz-page) / <alpha-value>)",
          card: "hsl(var(--frenz-card) / <alpha-value>)",
          line: "hsl(var(--frenz-line) / <alpha-value>)",
          fill: "hsl(var(--frenz-fill) / <alpha-value>)",
          // the chat's lilac ground (design/Chat.dc.html, 2026-10-22)
          chat: "hsl(var(--frenz-chat) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        soft: "0 1px 2px hsl(240 10% 4% / 0.08), 0 8px 28px -12px hsl(240 10% 4% / 0.18)",
        card: "0 1px 3px hsl(240 10% 4% / 0.08), 0 20px 48px -18px hsl(240 10% 4% / 0.26)",
        elevated:
          "0 4px 12px hsl(240 10% 4% / 0.12), 0 40px 80px -24px hsl(240 10% 4% / 0.38)",
        luxury:
          "inset 0 1px 0 hsl(0 0% 100% / 0.07), 0 4px 20px hsl(0 0% 0% / 0.45), 0 24px 64px hsl(0 0% 0% / 0.28)",
        "glow-blue":
          "0 0 28px hsl(252 95% 70% / 0.28), 0 0 64px hsl(270 95% 72% / 0.1)",
        "glow-gold":
          "0 0 28px hsl(43 96% 56% / 0.32), 0 0 64px hsl(43 96% 56% / 0.12)",
        // The Frenz screens' elevations — neutral ink only, never a coloured glow (owner, 2026-10-18).
        "frenz-card": "0 1px 2px hsl(var(--frenz-ink) / 0.05)",
        "frenz-raised": "0 1px 2px hsl(var(--frenz-ink) / 0.05), 0 12px 28px -20px hsl(var(--frenz-ink) / 0.25)",
        "frenz-float": "0 16px 36px -12px hsl(var(--frenz-ink) / 0.28)",
      },
      fontFamily: {
        /*
          🔴 THE FALLBACK INSIDE var() IS THE FIX (owner, 2026-10-07, screenshots:
          the installed app rendering every page in a SERIF — Times).
          `--font-sans` is defined by next/font on a class whose name is hashed
          PER BUILD. When the installed app shows a document from one build
          with a stylesheet from another (a cached page across a deploy), that
          class defines nothing, `var(--font-sans)` is undefined, and a var()
          with no fallback makes the WHOLE font-family declaration invalid at
          computed-value time — the browser's initial font, Times, wins over
          every name after the comma. A fallback INSIDE var() keeps the
          declaration valid: the phone's own sans instead of a serif.
        */
        sans: ["var(--font-sans, -apple-system)", "-apple-system", "BlinkMacSystemFont", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        // The Frenz screens (design/*.dc.html): Sora for headings, Hanken Grotesk for body. Same var() fallback reason as above.
        heading: ["var(--font-heading, -apple-system)", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        body: ["var(--font-body, -apple-system)", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        // The Home hero's H1 only (Bricolage Grotesque 800).
        display: ["var(--font-display, -apple-system)", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        // The brand gradient: the full three stops (avatars, rings, profile button) and the two-stop button fill.
        "frenz-gradient": "linear-gradient(135deg, hsl(var(--frenz-blue)), hsl(var(--frenz-violet)) 55%, hsl(var(--frenz-magenta)))",
        "frenz-gradient-x": "linear-gradient(90deg, hsl(var(--frenz-blue)), hsl(var(--frenz-violet)))",
        // The sent chat bubble, exactly as design/Chat.dc.html draws it: 135deg, #3D5AFE → #6A44EA.
        "frenz-bubble": "linear-gradient(135deg, hsl(var(--frenz-blue)), hsl(var(--frenz-bubble-end)))",
        "grid-pattern":
          "linear-gradient(to right, hsl(var(--border) / 0.4) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.4) 1px, transparent 1px)",
      },
      keyframes: {
        // the who-reposted badge on a reel: holds, then floats up and fades like a story reaction (owner, 2026-10-27)
        // a sticker gift's play (owner, 2026-10-28: "animation should last 3 secs … every 3 secs in chat") — a pop and a
        // wiggle in the first second, then still; transform only, so it runs on the compositor
        "sticker-play": {
          "0%, 40%, 100%": { transform: "none" },
          "8%": { transform: "scale(1.14) rotate(-7deg)" },
          "16%": { transform: "scale(1.1) rotate(6deg)" },
          "24%": { transform: "scale(1.08) rotate(-4deg)" },
          "32%": { transform: "scale(1.04) rotate(2deg)" },
        },
        // design/frenz-reels.html: a like or save turning on pumps once (transform only)
        "reel-pump": {
          "0%": { transform: "scale(1)" },
          "35%": { transform: "scale(0.78)" },
          "70%": { transform: "scale(1.18)" },
          "100%": { transform: "scale(1)" },
        },
        "reel-marquee": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        "badge-rise": {
          "0%, 62%": { opacity: "1", transform: "translateY(0) scale(1)" },
          "70%": { opacity: "1", transform: "translateY(-14px) scale(1.15)" },
          "100%": { opacity: "0", transform: "translateY(-72px) scale(1.5)", visibility: "hidden" },
        },
        "badge-fade": {
          "0%, 62%": { opacity: "1" },
          "100%": { opacity: "0", visibility: "hidden" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0)" },
          "50%": { transform: "translate3d(-2%,3%,0)" },
        },
        "drift-slow": {
          "0%, 100%": { transform: "translate3d(0,0,0)" },
          "50%": { transform: "translate3d(3%,-2%,0)" },
        },
      },
      animation: {
        // every sent sticker, everywhere: a 3 s play, again and again
        sticker: "sticker-play 3s ease-in-out infinite",
        // the gift sheet's grid: one play per turn (gift-sheet.tsx moves the turn every 3 s)
        "sticker-once": "sticker-play 3s ease-in-out 1",
        "fade-up": "fade-up 0.5s ease-out both",
        float: "float 3.5s ease-in-out infinite",
        "pulse-glow": "pulse-glow 3s ease-in-out infinite",
        drift: "drift 16s ease-in-out infinite",
        "drift-slow": "drift-slow 22s ease-in-out infinite",
        // Login hero constellation — keyframes in globals.css.
        "login-float": "login-float 6s ease-in-out infinite",
        "login-pulse": "login-pulse 7s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate, typography],
};

export default config;
