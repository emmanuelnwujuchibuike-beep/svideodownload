/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    /*
      First, so app/entry.css can inline globals.css BEFORE Tailwind compiles it under tailwind.entry.config.ts
      (2026-10-27, the cold-entry stylesheet). Not a new dependency: postcss-import is a dependency of tailwindcss 3
      itself, already installed with it. It does nothing to a file without @import.
    */
    "postcss-import": {},
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
