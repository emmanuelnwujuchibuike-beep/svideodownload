/**
 * What a refused friend action says, by `FriendActionResult.reason`. One list for the
 * API route (app/api/friends/[id]) and the Friends page's Server Actions, so the same
 * refusal reads the same wherever it was sent from. Plain words, never a score.
 */
export const FRIEND_ERRORS: Record<string, { msg: string; status: number }> = {
  self: { msg: "That's you.", status: 400 },
  blocked: { msg: "You can't send a request to this user.", status: 400 },
  exists: { msg: "You're already friends.", status: 400 },
  incoming: { msg: "They already sent you a request — check your requests.", status: 409 },
  cap: { msg: "You've sent a lot of requests today. Try again tomorrow.", status: 429 },
  unavailable: { msg: "Couldn't update friendship right now.", status: 400 },
  // Feature 19 · Part 2 — plain words, never a score (lib/social/friend-requests/trust.ts)
  policy: { msg: "They aren't taking friend requests from everyone right now. You can still follow them.", status: 403 },
  cooldown: { msg: "You can't send them another request just yet.", status: 429 },
  hourly: { msg: "That's a lot of requests in a short time. Take a short break and try again.", status: 429 },
  paused: { msg: "Sending friend requests is paused for a day — most of your recent ones weren't accepted.", status: 429 },
  note_link: { msg: "Notes can't include links.", status: 400 },
  note_contact: { msg: "Notes can't include phone numbers, emails or other apps — say hello here instead.", status: 400 },
  note_repeated: { msg: "You've sent this same note to a lot of people today. Write something personal, or send without a note.", status: 429 },
};

export function friendErrorFor(reason: string | undefined): { msg: string; status: number } {
  return (reason && FRIEND_ERRORS[reason]) || { msg: "Couldn't update friendship right now.", status: 400 };
}
