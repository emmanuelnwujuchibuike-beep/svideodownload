"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE REEL VIEWER'S TWO SHEETS — and why they live behind a dynamic import
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The ••• overflow and the Send chooser, as content. The sheet SHELL (drag,
 * springs, focus, safe area) is `media-action-sheet`; this is only what goes
 * inside it.
 *
 * ── Why this is a separate file rather than JSX in `reel-viewer` ───────────
 *
 * 🔴 A budget failure, measured, not guessed. `lib/perf/budget.test.ts` holds
 * every route under 340 kB of gzipped first-load JS, and rebuilding the sheet
 * took `/(app)/home/page` from 337.2 kB to 341 kB — over the ratchet, on a route
 * that does not even show a reel until you tap one.
 *
 * The cause is ordinary and worth naming: /home reaches the reel deck through a
 * `dynamic()` import, so the deck itself is already async — but the sheet
 * module was imported STATICALLY by `reel-viewer`, and being shared it got
 * hoisted into a chunk /home loads eagerly. Nothing in the source looks wrong;
 * the only way to see it is to build and measure.
 *
 * Splitting it here means the bytes arrive when somebody taps •••, which is a
 * deliberate act with a spring animation in front of it — there is no frame in
 * which a user is waiting on this chunk. See the "code-split heavy widgets off
 * first-load" rule in project memory.
 *
 * ── The prop list is long on purpose ───────────────────────────────────────
 *
 * Every one of these is state or a handler that belongs to the viewer, and the
 * alternative — reaching into a context, or duplicating the handlers here —
 * would either couple this file to the deck's internals or give the sheet its
 * own second copy of behaviour that must then be kept in sync. An explicit
 * interface across a chunk boundary is the readable version of the same thing.
 */

import {
  BellOff,
  Compass,
  Download,
  EyeOff,
  Flag,
  FolderPlus,
  Gauge,
  Info,
  Layers,
  Link2,
  OctagonAlert,
  Pencil,
  PictureInPicture2,
  Repeat2,
  Send as SendIcon,
  Share,
  User,
  UserX,
  Volume2,
  VolumeX,
} from "lucide-react";

import {
  MediaActionSheet,
  SheetGroup,
  SheetRow,
  SheetSegmentedRow,
  SheetToggleRow,
} from "@/features/feed/media-action-sheet";

export interface ReelMoreSheetProps {
  open: boolean;
  onClose: () => void;
  /** Post identity + the viewer's relationship to it. */
  isOwner: boolean;
  publisherHandle: string;
  /** Actions. */
  onShare: () => void;
  onCopyLink: () => void;
  onOpenInBrowser: () => void;
  onViewDetails: () => void;
  onAddToCollection: () => void;
  onDownload: () => void;
  onEditPost: () => void;
  /** Creator + audio. */
  following: boolean;
  onToggleFollow: () => void;
  onMuteCreator: () => void;
  /** `native` = there is a real <video> to act on; audio/speed/PiP are hidden
   *  otherwise, because a control that cannot do anything is worse than absent. */
  native: boolean;
  muted: boolean;
  onToggleMute: () => void;
  /** Playback. */
  rate: number;
  quickRates: readonly number[];
  formatRate: (r: number) => string;
  onPickRate: (r: number) => void;
  onCycleRate: () => void;
  pipSupported: boolean;
  pipActive: boolean;
  onTogglePip: () => void;
  qualityLabel: string | null;
  onCycleQuality: () => void;
  /** Feedback + moderation. */
  onHidePost: () => void;
  onNotInterested: () => void;
  onReport: () => void;
  onBlock: () => void;
}

/**
 * The ••• overflow, enumerated top to bottom exactly as the owner's reference
 * screenshot has it (2026-08-11).
 *
 * Two groups the reference does not show are still here, and deliberately:
 *
 *   • Edit post — the owner branch. A reference of somebody else's reel cannot
 *     show it, and its absence would mean a creator could not edit their own
 *     post from the viewer at all.
 *   • Report / Block — moderation. Removing the only in-viewer path to reporting
 *     a reel in order to match a mockup would be a safety regression, so they
 *     take the reference's own destructive pattern (red glyph, red label) as a
 *     final group.
 */
export function ReelMoreSheet(p: ReelMoreSheetProps) {
  const onQuickLadder = p.quickRates.includes(p.rate);
  return (
    <MediaActionSheet open={p.open} onClose={p.onClose}>
      <SheetGroup>
        <SheetRow icon={Share} label="Share" onClick={p.onShare} />
        <SheetRow icon={Link2} label="Copy link" onClick={p.onCopyLink} />
        <SheetRow icon={Compass} label="Open in browser" onClick={p.onOpenInBrowser} />
      </SheetGroup>

      <SheetGroup>
        <SheetRow icon={Info} label="View post details" onClick={p.onViewDetails} />
        <SheetRow icon={FolderPlus} label="Add to collection" onClick={p.onAddToCollection} />
        <SheetRow icon={Download} label="Download" onClick={p.onDownload} />
        {p.isOwner ? <SheetRow icon={Pencil} label="Edit post" onClick={p.onEditPost} /> : null}
      </SheetGroup>

      {/* Creator & audio. The reference makes following a SWITCH — a state you
          hold, shown as a state you can flip — and the sheet stays open after
          it, because unfollowing by accident should be one tap to undo. */}
      {!p.isOwner || p.native ? (
        <SheetGroup>
          {!p.isOwner ? (
            <SheetToggleRow
              icon={User}
              label={p.following ? "Following creator" : "Follow creator"}
              checked={p.following}
              onChange={p.onToggleFollow}
            />
          ) : null}
          {!p.isOwner ? <SheetRow icon={BellOff} label="Mute creator" onClick={p.onMuteCreator} /> : null}
          {p.native ? (
            <SheetRow
              icon={p.muted ? VolumeX : Volume2}
              label={p.muted ? "Unmute audio" : "Mute audio"}
              onClick={p.onToggleMute}
            />
          ) : null}
        </SheetGroup>
      ) : null}

      {/* Playback. Speed is PICKED, not cycled: the reference puts the four
          common rungs inline, so 1× → 2× is one tap instead of three taps, three
          toasts and three sheet dismissals. The label still cycles the FULL
          six-rung ladder, so 0.75× and 1.25× are not lost — they are simply not
          worth a segment each. */}
      {p.native ? (
        <SheetGroup>
          <SheetSegmentedRow
            icon={Gauge}
            /*
              The rate is stated in the label ONLY when no segment can state it.
              With 1× lit, "Playback speed: 1×" says the same thing twice and is
              the difference between a whole label and an ellipsis on a narrow
              phone; at 0.75× — a rung the four segments do not cover — the label
              is the only place the real rate appears, so it says it.
            */
            label={onQuickLadder ? "Playback speed" : `Playback speed: ${p.formatRate(p.rate)}`}
            options={p.quickRates}
            selected={onQuickLadder ? p.rate : null}
            onSelect={p.onPickRate}
            onLabelClick={p.onCycleRate}
            formatOption={p.formatRate}
          />
          {/* Rendered only where PiP genuinely works — see use-pip.ts for why the
              ELEMENT is asked, not just the browser. */}
          {p.pipSupported ? (
            <SheetRow
              icon={PictureInPicture2}
              label={p.pipActive ? "Exit picture-in-picture" : "Picture-in-picture"}
              onClick={p.onTogglePip}
            />
          ) : null}
          {p.qualityLabel ? (
            <SheetRow icon={Layers} label="Video quality" value={p.qualityLabel} onClick={p.onCycleQuality} />
          ) : null}
        </SheetGroup>
      ) : null}

      {!p.isOwner ? (
        <SheetGroup>
          <SheetRow icon={EyeOff} label="Hide this post" onClick={p.onHidePost} />
          <SheetRow icon={OctagonAlert} label="Not interested" onClick={p.onNotInterested} danger />
        </SheetGroup>
      ) : null}

      {!p.isOwner ? (
        <SheetGroup>
          <SheetRow icon={Flag} label="Report post" onClick={p.onReport} danger />
          <SheetRow icon={UserX} label={`Block @${p.publisherHandle}`} onClick={p.onBlock} danger />
        </SheetGroup>
      ) : null}
    </MediaActionSheet>
  );
}

/**
 * Send's two-option chooser (owner, 2026-08-11: "when a user click the send
 * button two options show").
 *
 * Two rows and nothing else. It is a fork, not a menu: adding a third thing here
 * would rebuild the clutter that merging Repost into Send removed.
 *
 * Each row states its AUDIENCE, because that is the only difference between them
 * and it is the thing a viewer is deciding. "Repost" alone does not say "your
 * followers will see this", and that is exactly the surprise worth avoiding on a
 * public action.
 *
 * It is the SAME sheet component as the ••• overflow, not a second one that
 * looks similar — it used to be a hand-rolled copy of the old overflow's shell,
 * which is how a surface ends up with two backdrops, two springs and two
 * slightly different cancel buttons.
 */
export function ReelSendSheet({
  open,
  onClose,
  reposted,
  onSendToFriends,
  onRepost,
}: {
  open: boolean;
  onClose: () => void;
  reposted: boolean;
  onSendToFriends: () => void;
  onRepost: () => void;
}) {
  return (
    <MediaActionSheet open={open} onClose={onClose} label="Send or repost">
      <SheetGroup>
        <SheetRow icon={SendIcon} label="Send to friends" onClick={onSendToFriends} />
        <SheetRow icon={Repeat2} label={reposted ? "Manage your repost" : "Repost"} onClick={onRepost} />
      </SheetGroup>
    </MediaActionSheet>
  );
}
