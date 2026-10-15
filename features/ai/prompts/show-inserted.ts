/**
 * After a prompt suggestion is inserted: focus the field, grow it to show the WHOLE prompt (up to
 * 60 % of the screen, then it scrolls inside), put the caret at the end and bring it into view.
 * The text is never truncated — the field's own limit is the model's (KLING_OMNI.prompt.maxChars).
 */
export function showInsertedPrompt(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  const cap = Math.round(window.innerHeight * 0.6);
  el.style.height = `${Math.min(el.scrollHeight + 2, cap)}px`;
  el.focus({ preventScroll: true });
  const end = el.value.length;
  el.setSelectionRange(end, end);
  el.scrollTop = 0;
  el.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/** Bring a section (the reference slots, the photo) into view. */
export function scrollToSection(el: HTMLElement | null): void {
  el?.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
