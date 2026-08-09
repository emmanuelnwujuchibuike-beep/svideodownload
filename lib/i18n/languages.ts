/**
 * The top ~50 world languages for the header language selector (owner). Each has a
 * BCP-47 code, its English name and its endonym (native name). The selector stores
 * the chosen code in a cookie + localStorage; content translation itself is driven
 * by the i18n catalogue (lib/i18n/messages), which falls back to the default locale
 * for any string not yet translated — so a pick is honoured as far as translations
 * exist and is remembered for when more are added.
 *
 * ── This list is a WISHLIST, not a capability (owner, 2026-08-09) ─────────────
 * "the language selections still doesn't work". Measured, it does not, and this
 * file is where the misunderstanding starts: it offers 53 languages while the
 * app declares 6 locales (`./locales`) and has written strings for exactly ONE
 * of them (`./messages` — `fr`/`ar`/`sw`/`pt`/`ha` are all `{}`).
 *
 * So a member picking Español got a cookie, a checkmark, and an English page,
 * with nothing on screen admitting why. `locales.ts` opens by calling that exact
 * outcome "worse than no switcher" — the picker was simply built against this
 * list instead of against `availableLocales()`.
 *
 * The list is KEPT, because remembering a preference for later is a real
 * feature and the intent to reach these languages is real. What changes is that
 * the picker now says which of them it can actually render today, derived from
 * the catalogues rather than asserted here — see `languageStatus`.
 */
export interface Language {
  code: string;
  name: string;
  native: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English" },
  { code: "zh", name: "Chinese (Mandarin)", native: "中文" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "ur", name: "Urdu", native: "اردو" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "sw", name: "Swahili", native: "Kiswahili" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "th", name: "Thai", native: "ไทย" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી" },
  { code: "fa", name: "Persian", native: "فارسی" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "ms", name: "Malay", native: "Bahasa Melayu" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "ro", name: "Romanian", native: "Română" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "yo", name: "Yoruba", native: "Yorùbá" },
  { code: "ig", name: "Igbo", native: "Igbo" },
  { code: "ha", name: "Hausa", native: "Hausa" },
  { code: "am", name: "Amharic", native: "አማርኛ" },
  { code: "zu", name: "Zulu", native: "isiZulu" },
  { code: "fil", name: "Filipino", native: "Filipino" },
  { code: "el", name: "Greek", native: "Ελληνικά" },
  { code: "cs", name: "Czech", native: "Čeština" },
  { code: "sv", name: "Swedish", native: "Svenska" },
  { code: "hu", name: "Hungarian", native: "Magyar" },
  { code: "he", name: "Hebrew", native: "עברית" },
  { code: "da", name: "Danish", native: "Dansk" },
  { code: "fi", name: "Finnish", native: "Suomi" },
  { code: "no", name: "Norwegian", native: "Norsk" },
  { code: "sk", name: "Slovak", native: "Slovenčina" },
  { code: "sr", name: "Serbian", native: "Српски" },
  { code: "hr", name: "Croatian", native: "Hrvatski" },
  { code: "bg", name: "Bulgarian", native: "Български" },
  { code: "ne", name: "Nepali", native: "नेपाली" },
];

export const LANGUAGE_COOKIE = "frenz_lang";

const DEFAULT_LANGUAGE: Language = { code: "en", name: "English", native: "English" };

export function findLanguage(code: string | null | undefined): Language {
  return LANGUAGES.find((l) => l.code === code) ?? DEFAULT_LANGUAGE;
}

/*
 * What a pick actually DOES is answered by `./language-status`, deliberately a
 * separate module: it reaches the message catalogues to measure coverage, and
 * this file is imported by the profile menu and the appearance page. Keeping the
 * measurement out of here means those surfaces never pull `messages/en` into
 * their first-load JS.
 */
