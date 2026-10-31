/**
 * Whole-page translation, browser half (owner, 2026-10-15: "I want all language to change in
 * everything that has text that is translatable and needs to translate").
 *
 * The hand-written catalogues (lib/i18n/messages) cover about 80 strings in the header, so
 * picking a language used to change almost nothing. This translates the interface text the
 * page actually shows instead: every visible text node, plus the `placeholder`, `aria-label`,
 * `title` and `alt` a reader or a screen reader meets. A MutationObserver keeps it up as
 * React renders new screens, sheets and toasts. Picking English puts every original back.
 *
 * Left alone, on purpose:
 *   · anything inside `translate="no"` / `.notranslate` (people's own words through RichText,
 *     the language list's native names), form values, code, scripts and styles
 *   · strings with no letters (numbers, times, sizes, emoji) and @handles, #tags, URLs
 *
 * Translations come from /api/i18n/translate (one model call per string per language for
 * everyone, then the shared cache) and are kept on the device per language, so a return
 * visit paints them with no request. This module is loaded only when someone picks a
 * language other than English: English visitors download none of it.
 */

const ATTRS = ["placeholder", "aria-label", "title", "alt"] as const;
type Attr = (typeof ATTRS)[number];

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE", "KBD", "SAMP", "TEMPLATE", "IFRAME", "OPTION"]);
const SKIP_SELECTOR = '.notranslate, [contenteditable=""], [contenteditable="true"], [data-no-translate]';
const LETTER = /\p{L}/u;
const NOT_PROSE = /^(?:[@#]\S+|https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+|\S+\.(?:com|net|org|app|io|ng)(?:\/\S*)?)$/i;
/** a number with a unit that reads the same everywhere: 4.2 MB, 12K, 1.5M, 30% */
const AMOUNT = /^[\d.,\s]+\s?(?:[KMGT]?B|[KMB]|%)$/i;

const BATCH = 100;
const FLUSH_MS = 40;
/*
  v2 (2026-10-31): the server answered every string in ENGLISH while its engine had no key (lib/i18n/machine-translate.ts),
  and each answer was kept here as that language's "translation" — so a phone that had tried a language kept showing
  English after the fix, without even asking. The old store is dropped, and an answer identical to the source is no longer
  kept on the device (the shared server cache still answers it at once).
*/
const STORE_PREFIX = "frenz:mt2:";
const OLD_STORE_PREFIX = "frenz:mt:";
const STORE_MAX = 4000;

/** Would this text be translated at all? (exported for tests) */
export function translatable(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 1000) return false;
  if (!LETTER.test(t)) return false;
  return !NOT_PROSE.test(t) && !AMOUNT.test(t);
}

/** Split off the whitespace around a string, so a translation keeps the spacing it sat in. */
export function splitSpace(text: string): [string, string, string] {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return [m[1]!, m[2]!, m[3]!];
}

interface Target {
  /** the source text (trimmed) this target shows */
  src: string;
  apply: (translated: string) => void;
}

interface State {
  lang: string;
  cache: Map<string, string>;
  pending: Map<string, Target[]>;
  timer: number;
  inflight: number;
  observer: MutationObserver | null;
  stored: boolean;
}

let state: State | null = null;
/** what the page said before translation, to put back on English and to notice React's own updates */
const textOriginal = new WeakMap<Text, string>();
const textWritten = new WeakMap<Text, string>();
const attrOriginal = new WeakMap<Element, Partial<Record<Attr, string>>>();
const attrWritten = new WeakMap<Element, Partial<Record<Attr, string>>>();
/** every node or element touched, so English can restore them (pruned of detached ones as it goes) */
const touchedText = new Set<Text>();
const touchedEls = new Set<Element>();

/** Long sessions: forget nodes React has removed (a WeakMap already lets them go; these sets don't). */
function prune(): void {
  if (touchedText.size > 6000) for (const n of touchedText) if (!n.isConnected) touchedText.delete(n);
  if (touchedEls.size > 3000) for (const e of touchedEls) if (!e.isConnected) touchedEls.delete(e);
}

function skipped(el: Element | null): boolean {
  if (!el) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  // the NEAREST translate attribute decides, as in HTML: a warning marked "yes" inside a "no" caption is translated
  if (el.closest("[translate]")?.getAttribute("translate") === "no") return true;
  return !!el.closest(SKIP_SELECTOR);
}

function loadStore(lang: string): Map<string, string> {
  try {
    // the v1 store may hold English as the "translation" (see STORE_PREFIX) — never read, removed
    localStorage.removeItem(OLD_STORE_PREFIX + lang);
    const raw = localStorage.getItem(STORE_PREFIX + lang);
    if (raw) return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    /* storage blocked or corrupt — start empty */
  }
  return new Map();
}

function saveStore(s: State): void {
  if (s.stored) return;
  s.stored = true;
  window.setTimeout(() => {
    s.stored = false;
    try {
      // only real translations: an answer equal to its source is a failure or untranslatable — asked again next time
      const entries = [...s.cache.entries()].filter(([src, t]) => t !== src).slice(-STORE_MAX);
      localStorage.setItem(STORE_PREFIX + s.lang, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      /* quota — the shared server cache still answers quickly */
    }
  }, 1500);
}

function want(s: State, src: string, target: Target): void {
  const hit = s.cache.get(src);
  if (hit !== undefined) {
    target.apply(hit);
    return;
  }
  const list = s.pending.get(src);
  if (list) list.push(target);
  else s.pending.set(src, [target]);
  if (!s.timer) s.timer = window.setTimeout(() => flush(s), FLUSH_MS);
}

async function flush(s: State): Promise<void> {
  s.timer = 0;
  if (state !== s) return;
  const batch = [...s.pending.keys()].slice(0, BATCH);
  if (!batch.length) return;
  const targets = batch.map((k) => s.pending.get(k)!);
  batch.forEach((k) => s.pending.delete(k));
  if (s.pending.size) s.timer = window.setTimeout(() => flush(s), FLUSH_MS);
  s.inflight++;
  try {
    const res = await fetch("/api/i18n/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang: s.lang, texts: batch }),
    });
    if (!res.ok) return;
    const { translations } = (await res.json()) as { translations?: unknown };
    if (!Array.isArray(translations) || translations.length !== batch.length || state !== s) return;
    batch.forEach((src, i) => {
      const t = typeof translations[i] === "string" ? (translations[i] as string) : src;
      s.cache.set(src, t);
      for (const target of targets[i]!) target.apply(t);
    });
    saveStore(s);
  } catch {
    /* offline or blocked — the page stays in English, nothing breaks */
  } finally {
    s.inflight--;
  }
}

function visitText(s: State, node: Text): void {
  const parent = node.parentElement;
  if (skipped(parent)) return;
  const current = node.data;
  // our own write coming back through the observer
  if (textWritten.get(node) === current) return;
  // React (or anything else) changed it: that is the new source
  textOriginal.set(node, current);
  if (!translatable(current)) return;
  const [lead, src, trail] = splitSpace(current);
  prune();
  touchedText.add(node);
  want(s, src, {
    src,
    apply: (t) => {
      // still showing the text this was asked for?
      if (textOriginal.get(node) !== current || node.data !== current || state !== s) return;
      const next = lead + t + trail;
      textWritten.set(node, next);
      if (next !== current) node.data = next;
    },
  });
}

function visitAttr(s: State, el: Element, attr: Attr): void {
  const value = el.getAttribute(attr);
  if (value === null) return;
  if (attrWritten.get(el)?.[attr] === value) return;
  const orig = attrOriginal.get(el) ?? {};
  orig[attr] = value;
  attrOriginal.set(el, orig);
  if (!translatable(value)) return;
  const src = value.trim();
  touchedEls.add(el);
  want(s, src, {
    src,
    apply: (t) => {
      if (el.getAttribute(attr) !== value || attrOriginal.get(el)?.[attr] !== value || state !== s) return;
      const w = attrWritten.get(el) ?? {};
      w[attr] = t;
      attrWritten.set(el, w);
      if (t !== value) el.setAttribute(attr, t);
    },
  });
}

function visitElementAttrs(s: State, el: Element): void {
  if (skipped(el)) return;
  for (const a of ATTRS) if (el.hasAttribute(a)) visitAttr(s, el, a);
}

function scan(s: State, root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    visitText(s, root as Text);
    return;
  }
  if (!(root instanceof Element) && root !== document.body) return;
  if (root instanceof Element) {
    if (SKIP_TAGS.has(root.tagName)) return;
    visitElementAttrs(s, root);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    // a skipped tag (script, code…) is never entered; a translate="no" block is walked through, because
    // a translate="yes" inside it (the link warning in a caption) is still interface text
    acceptNode: (n) => (n instanceof Element && SKIP_TAGS.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) visitText(s, n as Text);
    else visitElementAttrs(s, n as Element);
  }
}

function restoreAll(): void {
  for (const node of touchedText) {
    const orig = textOriginal.get(node);
    if (node.isConnected && orig !== undefined && node.data === textWritten.get(node)) node.data = orig;
    textWritten.delete(node);
  }
  for (const el of touchedEls) {
    const orig = attrOriginal.get(el) ?? {};
    const w = attrWritten.get(el) ?? {};
    for (const a of ATTRS) if (el.isConnected && orig[a] !== undefined && el.getAttribute(a) === w[a]) el.setAttribute(a, orig[a]!);
    attrWritten.delete(el);
  }
  touchedText.clear();
  touchedEls.clear();
}

/** Translate the page into `lang` and keep it translated; "en" (or null) puts the originals back. */
export function setPageLanguage(lang: string | null): void {
  const next = lang && lang !== "en" ? lang : null;
  if (state?.lang === next) return;
  if (state) {
    state.observer?.disconnect();
    window.clearTimeout(state.timer);
    state = null;
    restoreAll();
  }
  if (!next || typeof document === "undefined") return;
  const s: State = { lang: next, cache: loadStore(next), pending: new Map(), timer: 0, inflight: 0, observer: null, stored: false };
  state = s;
  scan(s, document.body);
  const title = document.querySelector("title")?.firstChild;
  if (title?.nodeType === Node.TEXT_NODE) visitText(s, title as Text);
  s.observer = new MutationObserver((records) => {
    if (state !== s) return;
    for (const r of records) {
      if (r.type === "characterData") visitText(s, r.target as Text);
      else if (r.type === "attributes") {
        const el = r.target as Element;
        if (!skipped(el)) visitAttr(s, el, r.attributeName as Attr);
      } else r.addedNodes.forEach((n) => scan(s, n));
    }
  });
  s.observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  const head = document.querySelector("title");
  if (head) s.observer.observe(head, { subtree: true, childList: true, characterData: true });
}
