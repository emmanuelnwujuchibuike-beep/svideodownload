import { BUBBLE_SKIN_DATA, BUBBLE_SKIN_SVG, type BubbleSkinEntry } from "@/lib/social/bubble-skins-data";
import type { ChatBubbleSkin } from "@/lib/social/chat-appearance";
import { cn } from "@/lib/utils";

import styles from "./bubble-skins.module.css";

/**
 * A bubble skin (design/frenzsave-bubble-styles.html): the class and attribute that paint the bubble, plus its
 * decorations. The bubble element carries `skinProps(skin)`; `<SkinDecorations>` goes INSIDE it as the last
 * children (absolutely placed, pointer-events none, so a hold or a tap still reaches the bubble).
 */
export function skinProps(skin: ChatBubbleSkin, mini = false): { className: string; "data-skin": string } {
  return { className: cn(styles.skin, mini && styles.mini), "data-skin": skin };
}

export function SkinDecorations({ skin }: { skin: ChatBubbleSkin }) {
  const entry: BubbleSkinEntry | undefined = BUBBLE_SKIN_DATA.find((s) => s.id === skin);
  if (!entry) return null;
  return (
    <>
      {entry.deco.map((d, i) =>
        "spikes" in d ? (
          <span key={i} aria-hidden className={styles.spikes} />
        ) : (
          <span
            key={i}
            aria-hidden
            className={cn(styles.deco, d.anim && styles[d.anim])}
            style={{ ...d.at, ...(d.w ? { width: d.w } : {}), height: d.h }}
            // static drawings from the design file, never user input
            dangerouslySetInnerHTML={{ __html: BUBBLE_SKIN_SVG[d.svg] }}
          />
        ),
      )}
    </>
  );
}
