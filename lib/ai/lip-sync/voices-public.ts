/**
 * Kling Lip Sync's own voices (the Replicate schema's `voice_id` enum, read
 * 2026-09-21), with a member-facing label — PURE so the admin panel and the
 * server-only adapter share one list. The ids are the provider's and never
 * typed by a member: the interface sends a catalogue id the server maps back.
 */
export interface KlingVoicePublic {
  id: string;
  label: string;
  /** BCP-47 primary subtag the voice speaks. */
  language: string;
  gender: "female" | "male" | "neutral";
}

export const KLING_VOICES_PUBLIC: readonly KlingVoicePublic[] = [
  { id: "en_AOT", label: "Aot", language: "en", gender: "neutral" },
  { id: "en_oversea_male1", label: "Overseas male", language: "en", gender: "male" },
  { id: "en_girlfriend_4_speech02", label: "Warm female", language: "en", gender: "female" },
  { id: "en_chat_0407_5-1", label: "Conversational", language: "en", gender: "neutral" },
  { id: "en_uk_boy1", label: "British boy", language: "en", gender: "male" },
  { id: "en_PeppaPig_platform", label: "Playful", language: "en", gender: "female" },
  { id: "en_ai_huangzhong_712", label: "Deep male", language: "en", gender: "male" },
  { id: "en_calm_story1", label: "Calm storyteller", language: "en", gender: "neutral" },
  { id: "en_uk_man2", label: "British man", language: "en", gender: "male" },
  { id: "en_reader_en_m-v1", label: "Reader (male)", language: "en", gender: "male" },
  { id: "en_commercial_lady_en_f-v1", label: "Commercial (female)", language: "en", gender: "female" },
  { id: "zh_genshin_vindi2", label: "Vindi", language: "zh", gender: "male" },
  { id: "zh_zhinen_xuesheng", label: "Student", language: "zh", gender: "neutral" },
  { id: "zh_ai_shatang", label: "Shatang", language: "zh", gender: "female" },
  { id: "zh_ai_kaiya", label: "Kaiya", language: "zh", gender: "female" },
  { id: "zh_chat1_female_new-3", label: "Conversational (female)", language: "zh", gender: "female" },
  { id: "zh_you_pingjing", label: "Calm", language: "zh", gender: "neutral" },
  { id: "zh_chengshu_jiejie", label: "Mature (female)", language: "zh", gender: "female" },
  { id: "zh_diyinnansang_DB_CN_M_04-v2", label: "Deep (male)", language: "zh", gender: "male" },
  { id: "zh_tianmeixuemei-v1", label: "Sweet (female)", language: "zh", gender: "female" },
];
