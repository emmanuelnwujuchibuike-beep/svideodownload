import { ProfileHighlights, type OwnStory } from "@/features/profile/profile-highlights";
import { getActiveStoryForUser } from "@/lib/social/stories";
import { listHighlights } from "@/lib/social/story-highlights";

/**
 * The profile's highlights row, read on the server (Stories Part 5): the member's highlights as this viewer may see
 * them, and — for the owner only — their stories up now (for "New"). Streams behind its own Suspense; renders nothing
 * when there is nothing to show.
 */
export async function ProfileHighlightsLoader({ profileId, viewerId }: { profileId: string; viewerId: string | null }) {
  const isOwner = !!viewerId && viewerId === profileId;
  const [highlights, own] = await Promise.all([listHighlights(profileId, viewerId), isOwner ? getActiveStoryForUser(profileId, viewerId) : Promise.resolve(null)]);
  const ownStories: OwnStory[] = (own?.stories ?? []).map((s) => ({ id: s.id, mediaUrl: s.mediaUrl, mediaKind: s.mediaKind, thumbnailUrl: s.thumbnailUrl }));
  if (!highlights.length && !ownStories.length) return null;
  return <ProfileHighlights profileId={profileId} initial={highlights} isOwner={isOwner} ownStories={ownStories} />;
}
