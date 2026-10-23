"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Lock } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { SkinDecorations, skinProps } from "@/features/social/bubble-skin";
import { fetchCanUseProSkins, setChatAppearance, useChatAppearance } from "@/features/social/use-chat-appearance";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { BUBBLE_SKIN_DATA, BUBBLE_SKIN_SECTIONS } from "@/lib/social/bubble-skins-data";
import {
  BUBBLE_STYLE_LABEL,
  BUBBLE_STYLE_SHAPE,
  bubbleStyleAvailable,
  type ChatAppearance,
  type ChatBubbleStyle,
  type ChatFontStyle,
  FONT_STYLES,
  FONT_STYLE_LABEL,
  isBubbleSkin,
  PRO_BUBBLE_SKINS,
} from "@/lib/social/chat-appearance";
import { FONT_STYLE_CLASS } from "@/lib/social/chat-fonts";
import { cn } from "@/lib/utils";

/** Curated swatches for the plain bubbles; the custom wheel is behind "+". A skin brings its own colours. */
const COLOR_SWATCHES = ["#0A84FF", "#6C4DFF", "#22C55E", "#F97316", "#EC4899", "#14B8A6", "#EF4444", "#64748B"];

/** The design's sections, in its order; "Default" (the chat's gradient bubble) leads Suggested. */
const SECTION_STYLES: Record<string, ChatBubbleStyle[]> = Object.fromEntries(
  BUBBLE_SKIN_SECTIONS.map(([section]) => [
    section,
    BUBBLE_SKIN_DATA.filter((s) => s.section === section).map((s) => (s.id === "default" ? "classic" : s.id) as ChatBubbleStyle),
  ]),
);
/** Notes from the design, with one change: this app's choice is per chat and only you see it. */
const SECTION_NOTE: Record<string, string> = {
  ...Object.fromEntries(BUBBLE_SKIN_SECTIONS.map(([section, note]) => [section, note])),
  Suggested: "Applies to this chat. Only you see it, on the messages you send.",
};
/** The shapes that were here before the skins — kept, so nobody's saved choice disappears. */
const SHAPES: ChatBubbleStyle[] = ["modern", "sharp", "pill", "tail"];
const BADGE: Partial<Record<ChatBubbleStyle, string>> = Object.fromEntries(
  BUBBLE_SKIN_DATA.flatMap((s) => ("badge" in s && s.badge ? [[s.id, s.badge]] : [])),
);

/**
 * A sent bubble in any style — the picker's preview and its tiles. A skin draws itself
 * (bubble-skins.module.css); "Default" and the shapes are the chat's own gradient bubble, as conversation-room
 * paints it.
 */
function SentBubble({ style, color, font, mini = false, children }: { style: ChatBubbleStyle; color: string | null; font: ChatFontStyle; mini?: boolean; children?: ReactNode }) {
  const size = mini ? "h-[42px] w-[118px] p-0" : "max-w-[78%] px-[15px] py-2.5 text-[15.5px] leading-[1.38]";
  if (isBubbleSkin(style)) {
    const p = skinProps(style, mini);
    return (
      <div data-skin={p["data-skin"]} className={cn(p.className, size, FONT_STYLE_CLASS[font])}>
        {children}
        <SkinDecorations skin={style} />
      </div>
    );
  }
  const shape = BUBBLE_STYLE_SHAPE[style];
  return (
    <div
      style={color ? { backgroundImage: "none", backgroundColor: color } : undefined}
      className={cn(
        "bg-frenz-bubble text-white",
        !color && "chat-bubble-gradient",
        shape.base,
        shape.tailMine,
        shape.protrudingTail && "chat-bubble-tail-mine relative overflow-visible",
        size,
        FONT_STYLE_CLASS[font],
      )}
    >
      {children}
    </div>
  );
}

/**
 * 🔴 "SELECT BUBBLE STYLE" — design/frenzsave-bubble-styles.html (owner, 2026-10-23: "This is how the chat bubble
 * page still looks", after the design was asked for). Cancel · title · Save across the top, a live preview of
 * the draft, and a sheet of drawn bubbles by section (Suggested, Halloween in October only, Critters, Nature,
 * Vibes with the Pro three), then the earlier shapes, font style and bubble colour, so nothing that worked before
 * is lost. Nothing is saved until Save. Still personal and per chat: only the viewer sees it.
 */
export function ChatAppearanceSheet({ conversationId, open, onClose }: { conversationId: string; open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const saved = useChatAppearance(conversationId);
  const [draft, setDraft] = useState<ChatAppearance>(saved);
  const [canUsePro, setCanUsePro] = useState(false);
  const [saving, setSaving] = useState(false);
  const colorInputRef = useRef<HTMLInputElement | null>(null);

  // every opening starts from what is saved, and learns whether the Pro skins are open to this member
  useEffect(() => {
    if (!open) return;
    setDraft(saved);
    let live = true;
    void fetchCanUseProSkins(conversationId).then((v) => live && setCanUsePro(v));
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      live = false;
      document.body.style.overflowY = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the picker opens
  }, [open, conversationId]);

  const changed = draft.bubbleStyle !== saved.bubbleStyle || draft.fontStyle !== saved.fontStyle || draft.bubbleColor !== saved.bubbleColor;
  const pick = (patch: Partial<ChatAppearance>) => {
    haptic("light");
    setDraft((d) => ({ ...d, ...patch }));
  };

  const save = async () => {
    if (!changed || saving) return;
    if ((PRO_BUBBLE_SKINS as readonly string[]).includes(draft.bubbleStyle) && !canUsePro) {
      toast(`Get Frenzsave Pro to use ${BUBBLE_STYLE_LABEL[draft.bubbleStyle]}`, "error");
      return;
    }
    setSaving(true);
    const res = await setChatAppearance(conversationId, { bubbleStyle: draft.bubbleStyle, fontStyle: draft.fontStyle, bubbleColor: draft.bubbleColor });
    setSaving(false);
    if (!res.ok) {
      if (res.error) toast(res.error, "error");
      return;
    }
    toast("Bubble style saved", "success");
    onClose();
  };

  const skinSelected = isBubbleSkin(draft.bubbleStyle);

  const tile = (style: ChatBubbleStyle) => {
    const active = draft.bubbleStyle === style;
    const pro = (PRO_BUBBLE_SKINS as readonly string[]).includes(style);
    const badge = BADGE[style];
    return (
      <motion.button
        key={style}
        type="button"
        aria-pressed={active}
        whileTap={{ scale: 0.96 }}
        transition={springs.press}
        onClick={() => pick({ bubbleStyle: style })}
        className={cn(
          "flex flex-col items-center rounded-[20px] border-2 px-1 pb-3 pt-1.5 transition-colors",
          active ? "border-foreground bg-secondary" : "border-transparent",
        )}
      >
        <span className="grid h-[92px] w-full place-items-center">
          <span className="scale-[0.8]">
            <SentBubble style={style} color={skinSelected || !active ? null : draft.bubbleColor} font={draft.fontStyle} mini />
          </span>
        </span>
        <span className={cn("flex flex-col items-center gap-px text-center text-sm font-medium leading-tight", pro && "text-muted-foreground")}>
          <span className="inline-flex items-center gap-1">
            {pro && !canUsePro ? <Lock className="h-3 w-3" aria-hidden /> : null}
            {BUBBLE_STYLE_LABEL[style]}
          </span>
          {badge ? <span className="text-[12.5px] text-muted-foreground">{badge}</span> : null}
        </span>
      </motion.button>
    );
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Select bubble style"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={springs.sheet}
          className="fixed inset-0 z-[120] flex justify-center bg-background"
        >
          <div className="relative flex h-dvh w-full max-w-[440px] flex-col overflow-hidden bg-background" style={{ paddingTop: "env(safe-area-inset-top)" }}>
            <header className="grid grid-cols-[72px_1fr_72px] items-center px-4 pb-2 pt-4">
              <button type="button" onClick={onClose} className="py-1.5 text-left text-[17px] font-medium">
                Cancel
              </button>
              <h1 className="text-center text-lg font-bold tracking-tight">Select bubble style</h1>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!changed || saving}
                className="py-1.5 text-right text-[17px] font-semibold text-primary transition-opacity disabled:opacity-35"
              >
                Save
              </button>
            </header>

            {/* the live preview: their bubble, then two of yours in the draft style */}
            <section aria-label="Preview" className="flex min-h-[250px] shrink-0 flex-col gap-[30px] px-4 pb-[34px] pt-[26px]">
              <div className="flex justify-start">
                <div className={cn("max-w-[78%] rounded-[22px] rounded-bl-md bg-secondary px-[15px] py-2.5 text-[15.5px] leading-[1.38] text-foreground", FONT_STYLE_CLASS[draft.fontStyle])}>
                  Did you see the clip I just saved? 😭
                </div>
              </div>
              {["Bubble styles just dropped on Frenzsave!", "Every chat gets the new look 💅"].map((text) => (
                <div key={text} className="flex justify-end">
                  <SentBubble key={draft.bubbleStyle} style={draft.bubbleStyle} color={skinSelected ? null : draft.bubbleColor} font={draft.fontStyle}>
                    {text}
                  </SentBubble>
                </div>
              ))}
            </section>

            <section className="flex min-h-0 flex-1 flex-col rounded-t-[26px] bg-card shadow-[0_-8px_30px_rgba(0,0,0,0.07)]">
              <span aria-hidden className="mx-auto mb-1 mt-2.5 h-[5px] w-[42px] shrink-0 rounded-full bg-foreground/15" />
              <div className="overflow-y-auto px-3.5 pb-10 pt-2 [scrollbar-width:none]" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 40px)" }}>
                {BUBBLE_SKIN_SECTIONS.map(([section]) => {
                  const styles = SECTION_STYLES[section]?.filter((s) => bubbleStyleAvailable(s)) ?? [];
                  if (styles.length === 0) return null;
                  return (
                    <div key={section}>
                      <h2 className="mx-1.5 mb-1 mt-3.5 text-lg font-extrabold tracking-tight">{section}</h2>
                      {SECTION_NOTE[section] ? <p className="mx-1.5 mb-2.5 text-sm leading-snug text-muted-foreground">{SECTION_NOTE[section]}</p> : null}
                      <div className="grid grid-cols-3 gap-1.5">{styles.map(tile)}</div>
                    </div>
                  );
                })}

                <h2 className="mx-1.5 mb-1 mt-3.5 text-lg font-extrabold tracking-tight">Shapes</h2>
                <div className="grid grid-cols-3 gap-1.5">{SHAPES.map(tile)}</div>

                <h2 className="mx-1.5 mb-2 mt-5 text-lg font-extrabold tracking-tight">Font style</h2>
                <div className="grid grid-cols-3 gap-1.5">
                  {FONT_STYLES.map((font) => (
                    <motion.button
                      key={font}
                      type="button"
                      aria-pressed={draft.fontStyle === font}
                      whileTap={{ scale: 0.96 }}
                      transition={springs.press}
                      onClick={() => pick({ fontStyle: font })}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-[20px] border-2 px-1 py-2.5 text-center text-xs font-medium transition-colors",
                        draft.fontStyle === font ? "border-foreground bg-secondary" : "border-transparent text-muted-foreground",
                      )}
                    >
                      <span className={cn("text-base font-bold", FONT_STYLE_CLASS[font])}>Aa</span>
                      {FONT_STYLE_LABEL[font]}
                    </motion.button>
                  ))}
                </div>

                <h2 className="mx-1.5 mb-1 mt-5 text-lg font-extrabold tracking-tight">Bubble color</h2>
                <p className="mx-1.5 mb-2.5 text-sm leading-snug text-muted-foreground">
                  {skinSelected ? "Drawn styles bring their own colours. Pick Default or a shape to colour your bubble." : "For Default and the shapes."}
                </p>
                <div className={cn("mx-1.5 flex flex-wrap items-center gap-2.5", skinSelected && "pointer-events-none opacity-40")}>
                  {[null, ...COLOR_SWATCHES].map((hex) => {
                    const active = draft.bubbleColor === hex;
                    return (
                      <button
                        key={hex ?? "default"}
                        type="button"
                        aria-label={hex ?? "Default colour"}
                        aria-pressed={active}
                        onClick={() => pick({ bubbleColor: hex })}
                        style={hex ? { backgroundColor: hex } : undefined}
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-card transition",
                          !hex && "bg-frenz-bubble chat-bubble-gradient",
                          active ? "ring-foreground" : "ring-transparent",
                        )}
                      >
                        {active ? <Check className="h-4 w-4 text-white" aria-hidden /> : null}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-label="Custom colour"
                    onClick={() => colorInputRef.current?.click()}
                    className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-border text-base text-muted-foreground"
                  >
                    +
                  </button>
                  <input
                    ref={colorInputRef}
                    type="color"
                    className="sr-only"
                    value={draft.bubbleColor ?? "#0A84FF"}
                    onChange={(e) => pick({ bubbleColor: e.target.value })}
                  />
                </div>
              </div>
            </section>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
