"use client";

import { useEffect } from "react";

import { useCommentTypingIndicator } from "@/features/social/use-typing";

/**
 * Typing indicator, code-split out of comments.tsx (Part 5 tranche 3 shipped
 * it inline). `use-typing.ts` is real, hardened Presence-channel
 * infrastructure (~370 lines) shared with messaging — `useCommentTypingIndicator`
 * and messaging's `useTypingIndicator` share the same internal channel
 * registry, so importing either one pulls in the whole module; tree-shaking
 * can't separate them. Before this, comments.tsx statically importing it put
 * that entire module on every route that renders comments (home, /p/[id],
 * reels, …) — routes that never needed messaging's presence machinery
 * before. Dynamically imported here instead, so it only loads once a
 * signed-in viewer's identity is actually ready.
 *
 * Hands notifyTyping/clearTyping to the parent via `onReady` (a plain
 * callback prop), not a forwarded ref — refs through `next/dynamic`
 * (React.lazy under the hood) are a real footgun with inconsistent support
 * across versions, and this needed to work the first time, not be debugged
 * live. The Composer that calls these is a sibling, not a child; before
 * `onReady` fires (this chunk hasn't loaded yet), the parent's wrapper
 * safely no-ops instead of throwing.
 */
export interface TypingHandle {
  notifyTyping: () => void;
  clearTyping: () => void;
}

export function CommentTypingIndicator({
  postId,
  handle,
  displayName,
  onReady,
}: {
  postId: string;
  handle: string;
  displayName: string;
  onReady: (h: TypingHandle) => void;
}) {
  const { typingNames, notifyTyping, clearTyping } = useCommentTypingIndicator(postId, handle, displayName);

  useEffect(() => {
    onReady({ notifyTyping, clearTyping });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifyTyping, clearTyping]);

  if (typingNames.length === 0) return null;
  return (
    <p className="-mt-3 mb-4 pl-1 text-xs font-medium text-muted-foreground">
      {typingNames.length === 1
        ? `${typingNames[0]} is typing…`
        : typingNames.length === 2
          ? `${typingNames[0]} and ${typingNames[1]} are typing…`
          : `${typingNames[0]} and ${typingNames.length - 1} others are typing…`}
    </p>
  );
}
