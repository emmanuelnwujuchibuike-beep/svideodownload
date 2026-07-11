import { createAdminClient } from "@/lib/supabase/admin";

/**
 * In-app interaction sound preferences (Part 4 spec 4b) — governs the
 * FOREGROUND Web Audio sound-effect layer only (lib/notifications/sound-fx.ts),
 * not the OS push-notification sound, which a web app cannot control on
 * either iOS or Android. DB-backed (not localStorage) so the setting
 * genuinely syncs across devices, matching the spec's own "synchronizes
 * across all devices" requirement.
 */
export interface SoundPrefs {
  masterEnabled: boolean;
  messageEnabled: boolean;
  mentionEnabled: boolean;
  reactionEnabled: boolean;
  typingEnabled: boolean;
}

const DEFAULT_PREFS: SoundPrefs = {
  masterEnabled: true,
  messageEnabled: true,
  mentionEnabled: true,
  reactionEnabled: true,
  typingEnabled: true,
};

interface Row {
  master_enabled: boolean;
  message_enabled: boolean;
  mention_enabled: boolean;
  reaction_enabled: boolean;
  typing_enabled: boolean;
}

function fromRow(r: Row): SoundPrefs {
  return {
    masterEnabled: r.master_enabled,
    messageEnabled: r.message_enabled,
    mentionEnabled: r.mention_enabled,
    reactionEnabled: r.reaction_enabled,
    typingEnabled: r.typing_enabled,
  };
}

export async function getSoundPrefs(userId: string): Promise<SoundPrefs> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("notification_sound_prefs")
      .select("master_enabled, message_enabled, mention_enabled, reaction_enabled, typing_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    return data ? fromRow(data as Row) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function setSoundPrefs(userId: string, patch: Partial<SoundPrefs>): Promise<{ ok: boolean }> {
  try {
    const db = createAdminClient();
    const clean: Record<string, boolean> = {};
    if (typeof patch.masterEnabled === "boolean") clean.master_enabled = patch.masterEnabled;
    if (typeof patch.messageEnabled === "boolean") clean.message_enabled = patch.messageEnabled;
    if (typeof patch.mentionEnabled === "boolean") clean.mention_enabled = patch.mentionEnabled;
    if (typeof patch.reactionEnabled === "boolean") clean.reaction_enabled = patch.reactionEnabled;
    if (typeof patch.typingEnabled === "boolean") clean.typing_enabled = patch.typingEnabled;
    if (Object.keys(clean).length === 0) return { ok: true };
    const { error } = await db
      .from("notification_sound_prefs")
      .upsert({ user_id: userId, ...clean, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
