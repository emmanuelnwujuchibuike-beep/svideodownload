import { getLessonMeta, LESSON_CATALOG, type LessonMeta } from "./catalog";
import type { Lesson, LessonSection } from "./types";

/**
 * Learning Academy™ lesson BODIES. Metadata lives in `catalog.ts` — see the note
 * there for why they are separate (short version: most consumers need a title,
 * not 15 kB of prose).
 *
 * Two rules govern what may be written here, and both are enforced by
 * `lib/content/reality-ledger.test.ts`, which scans this directory:
 *
 *   1. No unbuilt Frenz product may be described as usable today. Teach the
 *      technique, name third-party tools where that is the honest answer, and keep
 *      anything of ours that does not exist in future tense.
 *   2. No unsourced magnitude claims — no percentages, no "millions", no counts
 *      presented as measured.
 *
 * These lessons are also the internal-linking hub for the ~100 generated SEO pages
 * in `lib/seo/seo-pages.ts`. Many thin keyword pages linking into a few deep guides
 * is what turns that cluster into genuine topical authority rather than duplicate
 * -content risk.
 */

interface LessonBody {
  intro: string;
  sections: LessonSection[];
  faqs: { q: string; a: string }[];
}

const LESSON_BODIES: Record<string, LessonBody> = {
  "how-to-save-a-video": {
    intro:
      "Saving a video is three steps, and most of the difficulty people hit is in the first one — getting a link the downloader can actually read. This covers the happy path and the two places it usually goes wrong.",
    sections: [
      {
        heading: "The workflow",
        body: [
          "Every supported service works the same way. You are copying a public share link, handing it to the extractor, and choosing which of the available renditions you want.",
        ],
        steps: [
          {
            title: "Copy the share link",
            text: "Open the post and use the app's own Share or Copy link action. Do not copy the address bar on mobile — apps often put a tracking or session URL there that resolves differently for you than for anyone else.",
          },
          {
            title: "Paste it into the box",
            text: "Paste and the metadata is fetched: title, thumbnail, duration, and the list of renditions the source actually offers.",
          },
          {
            title: "Pick a format and save",
            text: "Choose a video quality or take the audio track on its own. The file downloads through your browser's own download manager, so it lands wherever your downloads normally go.",
          },
        ],
      },
      {
        heading: "When a link will not resolve",
        body: [
          "The two common causes are private content and shortened links. If the post is private, restricted to followers, or age-gated, there is no public rendition to fetch and no downloader can produce one — that is a permission boundary, not a technical limitation.",
          "Shortened links usually work, because they get followed to their destination first. If one fails, open it in a browser and copy the full URL it lands on.",
          "A link that worked yesterday and fails today normally means the post was deleted or made private at the source.",
        ],
      },
      {
        heading: "Choosing a quality",
        body: [
          "Higher resolution means a larger file and nothing else — it cannot add detail the original never had. If the source was recorded on a phone in poor light, a larger rendition is a bigger file of the same footage.",
          "Take audio on its own when you only want the sound: a music track, a podcast segment, an interview you plan to quote. The file is dramatically smaller and there is no quality cost, because the audio stream is the same either way.",
        ],
      },
    ],
    faqs: [
      {
        q: "Where does the file go?",
        a: "Wherever your browser saves downloads. On iPhone that is the Files app under Downloads; on Android it is usually the Downloads folder; on desktop it follows your browser setting.",
      },
      {
        q: "Do I need an account?",
        a: "No. Saving works without signing in. An account adds synced history across devices and the ability to share what you save into Frenz.",
      },
      {
        q: "Is there a limit?",
        a: "There is a daily cap that varies by plan, which exists to keep the extraction workers responsive for everyone rather than to upsell you.",
      },
    ],
  },

  "what-you-can-and-cannot-download": {
    intro:
      "Downloading and republishing are different acts with very different rules, and conflating them is the single most common way people get themselves into trouble. This is the honest version, without legal theatre.",
    sections: [
      {
        heading: "Saving is not the same as owning",
        body: [
          "Having a copy of a file gives you no rights over the work it contains. The person who made it still holds the copyright, and that is true whether the post was public, whether it had a watermark, and whether it credited anyone.",
          "Personal use — watching something offline, keeping a copy of a video you appeared in, saving a reference for your own work — is a very different position from publishing that file somewhere else under your own name.",
        ],
      },
      {
        heading: "Before you republish anything",
        body: [
          "Ask three questions. Did you create it? Do you have permission from whoever did? Or does your use fall under a genuine exception like commentary, criticism, news reporting or parody, where you are adding something rather than reposting wholesale?",
          "If the answer to all three is no, republishing is infringement, regardless of whether you credit the original creator. Credit is courtesy; it is not a licence.",
          "Reposting other people's work is also the fastest way to lose an account. Platform copyright systems act on the upload, not on your intent.",
        ],
      },
      {
        heading: "What is never acceptable",
        body: [
          "Private or restricted content that was not shared with you. Paid or subscription content redistributed for free. Anything involving a minor in a sexual context. Content used to harass, impersonate or defraud someone.",
          "These are not edge cases requiring judgement. If a download would only be useful for one of these, it is not a use this product supports, and reports are acted on.",
        ],
      },
      {
        heading: "Watermarks",
        body: [
          "Some sources add a watermark during export and some do not; where a clean rendition is what the source itself serves, that is what you get. Removing an author's own signature from their work in order to pass it off as yours is a separate act, and a dishonest one.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I use a downloaded clip in my own video?",
        a: "Sometimes — short excerpts used for commentary, review or parody may qualify as fair use or fair dealing depending on your jurisdiction. Wholesale reuse of someone's footage as the substance of your own video generally does not.",
      },
      {
        q: "The video has no watermark or credit. Is it free to use?",
        a: "No. Copyright is automatic on creation. The absence of a notice tells you nothing about the rights.",
      },
      {
        q: "What if I made the video and posted it myself?",
        a: "Then it is yours, and getting your own work back off a platform is one of the most legitimate reasons to use a downloader.",
      },
    ],
  },

  "how-to-edit-a-clip": {
    intro:
      "Most editing damage is not caused by bad cuts. It is caused by re-encoding the same footage repeatedly without realising it. Understanding that one mechanic will do more for your output than any effect.",
    sections: [
      {
        heading: "Generation loss, and why re-shared video looks bad",
        body: [
          "Video codecs are lossy: every encode discards detail to save space. Decoding and re-encoding a clip therefore loses a little more each time, and the losses compound. This is why a clip that has been downloaded, edited, uploaded, downloaded again and re-edited ends up soft and blocky while the original still looks fine.",
          "The practical rule is to minimise the number of encodes between the source and the final upload. Edit once, from the highest-quality rendition you have, and export once.",
        ],
      },
      {
        heading: "Trimming without re-encoding",
        body: [
          "Cutting a clip at the start or end does not require re-encoding at all. Stream-copy trimming keeps the original compressed data and only changes where playback begins and ends, so the result is bit-for-bit as good as the source.",
          "The catch is that cuts land on keyframes, so you cannot always cut at an exact arbitrary frame. For most social clips that imprecision is invisible and the quality saved is worth far more than frame-accuracy.",
        ],
        steps: [
          {
            title: "Start from the best source you have",
            text: "Re-download at the highest rendition rather than editing a copy you already compressed.",
          },
          {
            title: "Trim before anything else",
            text: "Cutting first means every later operation processes less footage, which is faster and produces a smaller file.",
          },
          {
            title: "Export once, at the target's native size",
            text: "Exporting larger than the destination displays wastes bytes; the platform will re-encode it down anyway, costing you another generation.",
          },
        ],
      },
      {
        heading: "Cropping and aspect ratio",
        body: [
          "Vertical feeds want tall video, and cropping a wide clip to a tall frame throws away most of the picture. When the subject is centred that is survivable; when it is not, you are better off framing the original inside the tall canvas and filling the space above and below than cutting the subject in half.",
          "Never stretch to fit. Distorted faces read as careless immediately, and it is the one artefact viewers consistently notice.",
        ],
      },
      {
        heading: "Tools",
        body: [
          "For simple trims and crops, your phone's built-in photo editor is genuinely fine and does not re-encode more than necessary. For anything involving multiple clips, free desktop editors handle it well. Command-line tools give you exact control over whether a re-encode happens at all.",
          "Editing tools built into Frenz are planned rather than available — until they ship, the techniques above apply to whatever editor you already use.",
        ],
      },
    ],
    faqs: [
      {
        q: "Why does my video look worse after uploading it?",
        a: "The platform re-encoded it. Every service re-compresses uploads to its own settings. Uploading a clean, correctly-sized file gives that encoder the best possible input to work from.",
      },
      {
        q: "Should I export at the highest possible bitrate?",
        a: "Up to a point. Beyond what the source actually contains, extra bitrate only makes the file larger and slower to upload without adding detail.",
      },
    ],
  },

  "how-to-add-subtitles": {
    intro:
      "A large share of social video is watched muted, which makes captions the difference between a clip that lands and one that gets scrolled past. They are also the single cheapest accessibility improvement available to you.",
    sections: [
      {
        heading: "Two kinds of captions",
        body: [
          "Burned-in captions are drawn into the video frames themselves. They always appear, they cannot be turned off, and they survive any platform. They also cannot be searched, translated, or read by a screen reader, and they are stuck at whatever size you chose.",
          "Sidecar captions are a separate timed text file — SRT or VTT — carried alongside the video. They are selectable, translatable, indexable by search engines, and accessible. Not every upload path accepts them.",
          "The pragmatic answer for social video is usually both: a sidecar file where the destination supports it, burned-in where it does not.",
        ],
      },
      {
        heading: "Writing captions that read well",
        body: [
          "Keep lines short — roughly six or seven words — and never more than two lines on screen at once. A caption block should sit long enough to read comfortably, which for a short line is around a second and a half.",
          "Caption what is said, not what you meant to say. Cleaning up filler is fine; rewriting the sentence is not, because viewers who need captions are then getting different content from everyone else.",
          "Position matters. Most platforms overlay their own interface on the lower part of the frame, so captions sitting at the very bottom get covered by the caption box, the username, or the buttons.",
        ],
        steps: [
          {
            title: "Transcribe first",
            text: "Get the words down before worrying about timing. Automatic transcription is a reasonable starting point but always needs a pass for names, jargon and homophones.",
          },
          {
            title: "Time in blocks, not words",
            text: "Split at natural clause boundaries so each block is a readable unit. Splitting mid-phrase makes viewers work.",
          },
          {
            title: "Watch it muted, end to end",
            text: "This is the step people skip and the only one that reliably catches captions that lag, overlap, or sit under the interface.",
          },
        ],
      },
      {
        heading: "Translation",
        body: [
          "Machine translation of captions is good enough to be worth doing and not good enough to be left unchecked, particularly with idiom, humour and names. If a language matters to your audience, have someone who speaks it read the file once.",
          "Automatic caption generation and translation inside Frenz are planned rather than available today.",
        ],
      },
    ],
    faqs: [
      {
        q: "SRT or VTT?",
        a: "VTT is the web standard and supports styling and positioning; SRT is simpler and accepted almost everywhere. If you have a choice, VTT.",
      },
      {
        q: "Do captions help reach?",
        a: "They help retention, which most ranking systems respond to — a muted viewer who can follow along keeps watching. They also make the words available to search engines when carried as a sidecar file.",
      },
    ],
  },

  "how-to-improve-video-quality": {
    intro:
      "There is a hard limit here worth stating up front: detail that was never captured cannot be restored. Everything genuinely useful in this area is about not losing what you already have.",
    sections: [
      {
        heading: "What upscaling really does",
        body: [
          "Upscaling invents pixels. Traditional methods interpolate between neighbours, producing a larger but softer image. Modern model-based upscalers hallucinate plausible detail based on what they were trained on, which often looks better and is nonetheless invention rather than recovery.",
          "That distinction matters when accuracy matters. For faces, text and fine detail, an upscaler can produce something confident and wrong. For general footage it usually looks better than the alternative.",
          "Where upscaling genuinely helps is with a low-resolution source shown on a large display. It cannot rescue footage that was blurry, badly lit or heavily compressed at capture.",
        ],
      },
      {
        heading: "The things that actually help",
        body: [
          "Take the highest rendition available at download time. This is the largest single quality decision you will make and it costs nothing but file size.",
          "Avoid repeat re-encodes, which is the same generation-loss point that governs editing.",
          "Match your export size to where it is going. Uploading a larger frame than the destination shows just hands its encoder more data to throw away.",
          "Prefer good light at capture over any amount of processing afterwards. Compression artefacts in dark, noisy footage are the hardest thing to fix and the easiest thing to avoid.",
        ],
      },
      {
        heading: "Reading the numbers",
        body: [
          "Resolution is frame size and bitrate is how much data describes each second. A high resolution at a low bitrate looks worse than a moderate resolution at a generous one, because the encoder is being asked to describe more pixels with the same budget.",
          "Frame rate is separate again. Higher frame rates suit motion; they do nothing for sharpness and cost bitrate that might have been better spent on detail.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I turn a low-resolution video into a high-resolution one?",
        a: "You can make the frame larger. You cannot recover detail the camera never recorded — anything added is inference, not restoration.",
      },
      {
        q: "Why is my download smaller than the original?",
        a: "You likely selected a lower rendition, or the source only publishes a compressed version. Sources routinely keep a higher-quality master that is never served publicly.",
      },
    ],
  },

  "how-to-organise-your-media": {
    intro:
      "Every media library reaches a point where finding something takes longer than re-downloading it. The fix is boring and it works: decide the structure before you need it.",
    sections: [
      {
        heading: "Name files so they sort themselves",
        body: [
          "Start filenames with a date in year-month-day order. It sorts chronologically as plain text in every file browser on every platform, with no special support required.",
          "Follow it with a project or source, then a short description. Avoid spaces if the files will ever touch a server, and avoid characters that mean something to a shell.",
          "A filename that describes the content is the only piece of metadata guaranteed to survive being copied, synced, emailed and re-downloaded.",
        ],
        steps: [
          {
            title: "Pick one structure",
            text: "By project, by source, or by date — one of them, consistently. The specific choice matters far less than not mixing three.",
          },
          {
            title: "Separate raw from finished",
            text: "Keep untouched downloads apart from anything you have edited. When an export goes wrong you want the original obviously identifiable.",
          },
          {
            title: "Prune on a schedule",
            text: "Most saved media is never opened twice. A periodic clear-out of what you did not use keeps search results meaningful.",
          },
        ],
      },
      {
        heading: "Why date-only sorting fails",
        body: [
          "Sorting by download date works until you have a few hundred files, at which point every result looks identical and the date tells you nothing about what the file is. Dates are a useful secondary axis and a poor primary one.",
        ],
      },
      {
        heading: "Backups",
        body: [
          "A file that exists in one place is not backed up. Phone storage fails, gets lost and gets wiped. Anything you would be upset to lose needs a second copy somewhere physically different.",
          "Synced cloud storage and project organisation inside Frenz are planned rather than available today, so for now that second copy should live wherever you already keep backups.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does download history count as a backup?",
        a: "No. History records what you fetched, not the files themselves — it lets you download something again while the source still exists.",
      },
    ],
  },

  "how-to-make-a-thumbnail": {
    intro:
      "A thumbnail is judged at roughly the size of a postage stamp, in a scrolling column, in under a second. Almost every common mistake comes from designing it at full size on a large screen.",
    sections: [
      {
        heading: "Design at the size it will be seen",
        body: [
          "Shrink your thumbnail to the size it appears in a feed and look at it there. If you cannot tell what it is, neither can anyone else, and no amount of detail at full size will help.",
          "This single check catches nearly everything: text too small, too many focal points, a subject lost against a busy background.",
        ],
      },
      {
        heading: "What works at small sizes",
        body: [
          "One subject. High contrast between that subject and its background. Faces, when relevant, because people find faces in an image before anything else. Few words in a heavy weight — three or four at most, and none of them repeating the title, which is already displayed next to the thumbnail.",
          "Consistent treatment across your uploads helps returning viewers recognise your work in a crowded feed before they read anything.",
        ],
        steps: [
          {
            title: "Pull a frame with a clear subject",
            text: "Scrub for a moment where the subject is well lit and unobstructed. Mid-motion frames are usually blurred.",
          },
          {
            title: "Crop tighter than feels right",
            text: "Wide shots become unreadable at feed size. Fill the frame with the thing the video is about.",
          },
          {
            title: "Check it against the interface",
            text: "Duration badges and platform chrome sit over parts of the image. Keep anything essential away from the corners and lower edge.",
          },
        ],
      },
      {
        heading: "Honesty",
        body: [
          "A thumbnail that misrepresents the video buys one click and costs the retention that ranking systems actually measure. Viewers who feel misled leave immediately, and that signal is far more damaging than a lower click-through rate.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I just use a frame from the video?",
        a: "Often yes, if it has a clear subject and good contrast. A crop of a well-chosen frame beats a badly-designed custom graphic.",
      },
    ],
  },

  "how-to-build-a-creator-workflow": {
    intro:
      "The difference between people who publish consistently and people who publish in bursts is almost never talent or equipment. It is having a pipeline dull enough to follow on a bad day.",
    sections: [
      {
        heading: "The six stages",
        body: [
          "Capture, organise, edit, caption, publish, review. Every creator does all six; the ones who sustain it have decided in advance how each stage happens rather than improvising each time.",
          "The value of writing it down is that it exposes the stage where you actually stall — which is usually not the one you assume.",
        ],
        steps: [
          {
            title: "Capture into one place",
            text: "Reference clips, your own footage, saved posts — one inbox folder. Sorting happens later; capture should never require a decision.",
          },
          {
            title: "Organise on a schedule, not per item",
            text: "Batch the filing. Deciding where each file goes at the moment you save it is where most systems collapse.",
          },
          {
            title: "Edit from the best source",
            text: "Always go back to the highest-quality original rather than a copy you have already exported.",
          },
          {
            title: "Caption before publishing",
            text: "Retrofitting captions after an upload means re-uploading, which costs another encode and resets any engagement.",
          },
          {
            title: "Publish deliberately",
            text: "Same export settings, same aspect ratio, same caption conventions. Consistency is what makes the work recognisable.",
          },
          {
            title: "Review honestly",
            text: "Look at retention rather than likes. Where people stop watching tells you what to change; a like total tells you almost nothing actionable.",
          },
        ],
      },
      {
        heading: "Batching",
        body: [
          "Doing one stage across several pieces at once is substantially faster than carrying each piece end to end, because you stop paying the cost of switching tools and mental mode. Edit three clips in one sitting, caption three in another.",
          "It also decouples publishing from inspiration, which is what makes a schedule survivable.",
        ],
      },
      {
        heading: "Rights, before you publish",
        body: [
          "If a piece contains anything you did not create, resolve the rights question before it goes out rather than after a takedown. Reposted material is the most common cause of lost accounts, and recovering one is far harder than avoiding the problem.",
        ],
      },
    ],
    faqs: [
      {
        q: "How much of this needs paid tools?",
        a: "None of it. Every stage described here can be done with a phone and free software. Better tools make stages faster; they do not make an absent workflow work.",
      },
      {
        q: "How often should I publish?",
        a: "At whatever interval you can sustain for months. Consistency compounds and bursts do not.",
      },
    ],
  },

  /* ----------------------------- Community School ---------------------------- */

  "how-feeds-and-friends-work": {
    intro:
      "Most confusion about a social feed comes from one question nobody answers plainly: who actually sees this? This covers how the relationship model works, what the feed does with it, and how to check rather than guess.",
    sections: [
      {
        heading: "Friends, followers and everyone else",
        body: [
          "A friend connection is mutual — both people agreed to it. That mutual link is what most privacy settings are built on, because it is the only relationship where both sides have consented.",
          "Following is one-directional. Someone following you has said they want to see your public posts; you have not said anything about them. Treat a follower as a member of the public who has opted in, not as someone you know.",
          "Everyone else is the public. If a post is public, this is its real audience — not the people you pictured while writing it.",
        ],
      },
      {
        heading: "How the feed decides what to show",
        body: [
          "A feed is ranked, not chronological. It weighs how recent something is, how close your connection to the author is, and what you have engaged with before.",
          "The practical consequence is that posting more often does not straightforwardly mean being seen more. Two posts competing for the same audience on the same day can suppress each other.",
          "It also means your own feed is not a reliable sample of what exists. Not seeing someone's posts is more often ranking than absence.",
        ],
      },
      {
        heading: "Check, do not assume",
        body: [
          "The reliable way to know what a stranger sees is to look at your profile while signed out, or from an account that is not connected to you. Settings describe intent; the signed-out view shows the result.",
          "Do this after any change to your visibility settings rather than trusting that the change did what you expected.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does posting more often get me seen more?",
        a: "Not reliably. Posts compete for the same audience, so two in a day can each reach fewer people than one would have. Consistency over weeks does more than volume in a day.",
      },
      {
        q: "Why can I not see a friend's post?",
        a: "Usually ranking rather than anything deliberate. Visiting their profile directly shows everything they have shared with you, which is the quickest way to tell the difference.",
      },
    ],
  },

  "how-to-share-without-oversharing": {
    intro:
      "Every sharing surface has a different reach, and they are easy to mix up because the action looks the same. Getting this straight is most of what makes sharing feel comfortable rather than risky.",
    sections: [
      {
        heading: "Reach, from narrowest to widest",
        body: [
          "A chat message goes to the people in that conversation and nobody else. It is the narrowest thing you can do and the right default for anything you would not want forwarded.",
          "A story is visible to the audience you have chosen for stories, and it expires. Expiry limits how long something is discoverable; it does not limit who can screenshot it while it is up.",
          "A post or reel is the widest. If your account is public, assume the audience is the public and the lifetime is indefinite.",
        ],
      },
      {
        heading: "Reshares change the audience, not the content",
        body: [
          "When something you posted is reshared, it reaches an audience you did not choose. That is the point of resharing, and it is also the thing to think about before posting.",
          "Authors control whether their content may be reshared. If you are sharing something you would not want travelling, turn resharing off at the source rather than relying on the goodwill of everyone who sees it.",
          "Resharing into chat is deliberately narrower than resharing onward publicly — the same privacy logic as above, applied to other people's content.",
        ],
      },
      {
        heading: "The forwarding test",
        body: [
          "Before sharing anything, ask what happens if it is forwarded once beyond the audience you pictured. If that outcome is fine, the surface you chose is fine.",
          "If it is not fine, the answer is a narrower surface — not a carefully worded caption. Captions do not travel as reliably as media does.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does an expiring story mean it is gone?",
        a: "It is no longer shown to viewers, which is not the same as being unrecoverable. Anyone who saw it could have captured it. Expiry reduces exposure; it does not undo it.",
      },
      {
        q: "Can I stop something being reshared?",
        a: "You can turn resharing off for your own content. Once something has already been reshared, that copy exists in its new context.",
      },
    ],
  },

  /* ------------------------ Security & Privacy School ------------------------ */

  "who-can-see-your-profile": {
    intro:
      "Profile visibility is a setting people set once and then reason about from memory, often incorrectly. This is what the states actually mean and how to verify yours.",
    sections: [
      {
        heading: "Public by default",
        body: [
          "A new account is public: the profile, and anything posted publicly, is visible to anyone including people who are not signed in. That is the correct default for a platform people arrive at from search, but it is worth knowing rather than discovering.",
          "Public also means indexable. Search engines can reach a public profile, which is a different and longer-lived kind of visibility than someone scrolling past.",
        ],
      },
      {
        heading: "What a hidden account changes",
        body: [
          "Hiding an account narrows its reach to friends. It is a visibility control: the account still works normally, you can still post, and your friends see everything as before.",
          "It is deliberately separate from suspension, which is an enforcement action that stops an account being used at all. They are different things with different causes, and one does not imply the other.",
          "Because hiding is friends-only rather than fully private, the honest way to think about it is: people you have mutually agreed to can see this, and nobody else can.",
        ],
      },
      {
        heading: "Verify from the outside",
        body: [
          "Open your profile in a private browsing window while signed out. That is what the public sees, with no cached assumptions.",
          "Do this after every visibility change. A settings screen tells you what you asked for; the signed-out view tells you what happened.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does hiding my account delete anything?",
        a: "No. It changes who can reach your profile going forward. Nothing you posted is removed, and reversing it restores the previous visibility.",
      },
      {
        q: "Is a hidden account the same as a suspended one?",
        a: "No, and the difference matters. Hiding is a visibility choice you make. Suspension is an enforcement action that locks the account. They are tracked separately.",
      },
    ],
  },

  "blocking-restricting-and-reporting": {
    intro:
      "Three tools that get used interchangeably and should not be. They solve different problems, and picking the wrong one is why people often feel none of them worked.",
    sections: [
      {
        heading: "Blocking — sever the connection",
        body: [
          "Blocking removes the relationship in both directions. The other person cannot message you, cannot see your content through the normal surfaces, and any mutual connection is broken.",
          "It is the strongest tool and it is not subtle. Someone who was interacting with you and suddenly cannot will usually work out that they were blocked. Use it when you want the contact to stop and do not mind that being evident.",
        ],
      },
      {
        heading: "Restricting — limit reach quietly",
        body: [
          "Restricting narrows what someone can do without severing anything. It is the right tool when the situation is awkward rather than dangerous — someone you would rather not block outright, but whose reach you want reduced.",
          "The advantage is that it is quiet. Nothing announces it, so it does not escalate a situation that escalation would make worse.",
        ],
      },
      {
        heading: "Reporting — involve moderation",
        body: [
          "Reporting is the only one of the three that tells anyone else. Blocking and restricting change your experience; reporting asks for a decision about whether something breaks the rules.",
          "Report when the behaviour would be a problem regardless of who it happened to. Block when you simply want it to stop for you. These are frequently both true, and doing both is normal.",
        ],
      },
      {
        heading: "Choosing quickly",
        body: [
          "If you feel unsafe: block, then report. Stopping contact first is the priority; the report can follow.",
          "If it is uncomfortable but not threatening: restrict, and see whether that settles it.",
          "If it is not aimed at you but breaks the rules: report, and leave your own connections alone.",
        ],
      },
    ],
    faqs: [
      {
        q: "Will they be told?",
        a: "No notification is sent for any of the three. Blocking tends to become obvious through its effects; restricting generally does not.",
      },
      {
        q: "Can I undo it?",
        a: "Blocking and restricting can both be reversed, though unblocking does not restore a mutual connection automatically — that has to be re-established.",
      },
    ],
  },

  /* ----------------------------- Developer School ---------------------------- */

  "getting-started-with-the-api": {
    intro:
      "The Frenzsave API is small on purpose: authenticate, analyze a link, request a download. Almost every integration is those three calls, and this walks through each one.",
    sections: [
      {
        heading: "Authentication",
        body: [
          "Every request carries your API key as a bearer token in the Authorization header. There is no session, no cookie and no OAuth dance — one header on every call.",
          "Keys are secrets. They belong on a server, in an environment variable. A key shipped in browser JavaScript or a mobile bundle is public the moment it ships, and anyone who reads it can spend your quota.",
        ],
        steps: [
          {
            title: "Store the key server-side",
            text: "Put it in an environment variable your server reads at runtime. Never commit it, and never reference it from client code.",
          },
          {
            title: "Send it as a bearer token",
            text: "Set `Authorization: Bearer <your key>` on every request. A missing or malformed key returns 401.",
          },
          {
            title: "Proxy from your own backend",
            text: "If a browser or app needs this data, call your backend and have it call the API. That keeps the key server-side and lets you apply your own limits.",
          },
        ],
      },
      {
        heading: "POST /v1/analyze — inspect before committing",
        body: [
          "Analyze takes a URL and returns what is actually available: the title, the duration, and the renditions the source offers. It does not produce a file.",
          "This is the call to make first in almost every flow. It is how you find out whether a link resolves at all, and it lets you show a user real options instead of guessing which formats exist.",
        ],
      },
      {
        heading: "POST /v1/download — request the file",
        body: [
          "Download returns metadata plus a download URL for the rendition you asked for. Fetch that URL to get the bytes.",
          "Treat the returned URL as short-lived and single-purpose. Request it when you are ready to use it rather than storing it and hoping it still resolves later.",
        ],
      },
      {
        heading: "GET /v1/usage — know where you stand",
        body: [
          "Usage reports your consumption against your quota. Polling it occasionally is far better than discovering your limit by being rejected mid-job.",
          "It is also the honest way to build a dashboard for your own users, rather than counting requests yourself and drifting out of sync.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do I need to call analyze before download?",
        a: "Not technically, but you almost always should. Analyze tells you which renditions exist, so download can request one that is actually available rather than failing on a guess.",
      },
      {
        q: "Can I call the API from the browser?",
        a: "You should not. It would expose your key to anyone who opens developer tools. Proxy through your own backend instead.",
      },
    ],
  },

  "handling-rate-limits-and-failures": {
    intro:
      "The difference between an integration that survives contact with production and one that does not is almost entirely how it handles the unhappy path. Two things matter: respecting your quota, and telling permanent failures apart from temporary ones.",
    sections: [
      {
        heading: "Quotas are daily and tier-based",
        body: [
          "Each plan has a daily request allowance, and requests count against it whether or not they succeed. A retry loop against a permanent failure will burn a day's quota surprisingly fast.",
          "Check `/v1/usage` rather than counting locally. Your own counter drifts the moment a request times out and you are unsure whether it landed.",
        ],
      },
      {
        heading: "Back off, do not hammer",
        body: [
          "When you are rate-limited, wait and retry with an increasing delay — double it each time, with a cap. Retrying immediately makes the situation worse for you and everyone else on the key.",
          "Add a small random jitter to the delay. Without it, everything that failed together retries together, and you rebuild the spike you were trying to avoid.",
        ],
        steps: [
          {
            title: "Respect the response",
            text: "If a response tells you how long to wait, wait that long. A server-supplied delay beats any heuristic you invent.",
          },
          {
            title: "Grow the delay",
            text: "Double the wait on each attempt — one second, two, four — up to a ceiling. Stop after a small number of attempts rather than retrying forever.",
          },
          {
            title: "Jitter it",
            text: "Randomise the delay slightly so concurrent clients do not synchronise into a thundering herd.",
          },
        ],
      },
      {
        heading: "Permanent versus temporary",
        body: [
          "Some failures will never succeed no matter how many times you try. Private content, deleted posts, and links that require a login are permission boundaries — retrying is pure waste, and it spends quota.",
          "Temporary failures are worth retrying: timeouts, rate limits, and transient upstream errors. These usually clear on their own.",
          "Encode this distinction explicitly in your client. The common bug is a blanket retry that treats a deleted video like a network blip and burns hundreds of requests discovering it is still deleted.",
        ],
      },
      {
        heading: "Degrade honestly",
        body: [
          "When something fails permanently, tell the user what happened in terms they can act on: the post is private, or it was removed. 'Something went wrong' sends people to support with nothing useful.",
          "When you are out of quota, say so rather than presenting it as a failure of the content. They are different problems with different fixes.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do failed requests count against my quota?",
        a: "Assume they do. Build on that assumption and a retry storm cannot quietly consume a day's allowance.",
      },
      {
        q: "How many times should I retry?",
        a: "A small number — three or four — with an increasing delay, and only for failures that could plausibly clear. Anything permanent should fail on the first attempt.",
      },
    ],
  },
};

/* --------------------------------- queries -------------------------------- */

/** Full lesson (metadata + body). Only `/learn/[slug]` needs this. */
export function getLesson(slug: string): Lesson | undefined {
  const meta = getLessonMeta(slug);
  const body = LESSON_BODIES[slug];
  if (!meta || !body) return undefined;
  return { ...meta, ...body };
}

/** Every lesson in full. Used by the Learning Academy index and the admin view. */
export function getLessons(): Lesson[] {
  return LESSON_CATALOG.map((meta) => ({ ...meta, ...LESSON_BODIES[meta.slug]! }));
}

/** Slugs that have a body — the set `generateStaticParams` may safely render. */
export function bodySlugs(): string[] {
  return Object.keys(LESSON_BODIES);
}

export type { LessonMeta };
