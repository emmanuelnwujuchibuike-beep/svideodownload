/** Fired on `window` to open a conversation's options sheet (thread-header.tsx) — the press and hold on the thread's empty
 *  background (conversation-room.tsx) sends it. Its own module so neither file has to import the other. */
export const CHAT_OPTIONS_EVENT = "frenz:chat-options";
