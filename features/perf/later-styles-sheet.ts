/*
  The entry stylesheet, as a lazy chunk (2026-10-31). Imported ONLY through `import()` in later-styles.tsx, so it is
  never on the landing's first paint: webpack emits app/entry.css as this chunk's stylesheet and inserts it when the
  chunk loads. It carries every class the landing's lazy parts (sheets, dialogs, the result card) use — the landing's
  own sheet (app/landing.css) deliberately holds only what is on screen at first paint.
*/
import "../../app/entry.css";

export const laterStylesLoaded = true;
