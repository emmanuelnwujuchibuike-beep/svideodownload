import { COURSES, getCourse, teachableCourses } from "./courses";
import type { Assessment, AssessmentResult, GradedAnswer, Question } from "./types";

/**
 * Course self-checks — "did that land?", asked at the end of a course.
 *
 * ── This is a SELF-CHECK, and the answer key is in the page source ────────────
 *
 * Grading happens in the browser, which means every correct answer ships to the
 * reader inside this module. That is stated plainly here because the alternative
 * is worse: a `/api/assessments/grade` endpoint would look like security while
 * providing none — the questions still ship, so anyone who wants the answers can
 * get them by submitting twice. Building that would be theatre, and it would put
 * a Paris round trip in front of a checkbox on pages that are currently static.
 *
 * The honest framing is the one the design actually supports: this is a way for
 * a reader to find out whether they understood a course, on their own, with no
 * stakes. Nobody is being certified.
 *
 * ── Therefore: no certificates, no scores on a profile, no leaderboard ────────
 *
 * All three were tempting and all three are the same mistake. A credential
 * backed by a quiz whose answers are in the page source is a fabricated
 * credential — the same family as the fabricated statistics this codebase has
 * already refused three times. If certification is ever wanted, it needs a
 * different mechanism, not a badge bolted onto this one.
 *
 * ── The score is the excuse; the review list is the product ───────────────────
 *
 * Every question names the lesson it was drawn from, so a wrong answer resolves
 * to "go and read this" rather than a number. `reviewLessonSlugs` is what the UI
 * leads with. A self-check that reports 4/7 and stops has told the reader
 * something they cannot act on.
 *
 * ── Truth gate, inherited ─────────────────────────────────────────────────────
 *
 * A question and its explanation are prose asserting how something behaves —
 * exactly the artefact the Academy's gate governs. Assessments therefore inherit
 * the course's gate rather than applying a second opinion: `teachableAssessments`
 * filters through `teachableCourses()`, and every question must be drawn from a
 * lesson its own course teaches. Both are pinned in `assessments.test.ts`.
 *
 * ── Bundle discipline ─────────────────────────────────────────────────────────
 *
 * This module is PROSE. `schools.ts` and `courses.ts` must never import it, for
 * the same reason they must never import lesson bodies — they are read by nav,
 * search and the campus index, i.e. nearly everywhere. Only the check's own
 * client island pulls this in, on the school pages that render it.
 */
const ASSESSMENTS: Assessment[] = [
  /* --------------------------- Creator School --------------------------- */
  {
    courseSlug: "saving-media-responsibly",
    title: "Check: saving media responsibly",
    passMark: 0.75,
    questions: [
      {
        id: "saving-1",
        lessonSlug: "how-to-save-a-video",
        prompt:
          "On a phone, why should you use the app's own Share or Copy link action rather than copying what is in the address bar?",
        choices: [
          { id: "a", text: "The address bar link is too long for the extractor to parse" },
          {
            id: "b",
            text: "Apps often put a tracking or session URL there, which resolves differently for you than for anyone else",
          },
          { id: "c", text: "Address bar links are blocked deliberately to prevent abuse" },
          { id: "d", text: "The share link contains the video file itself, so it downloads faster" },
        ],
        correctChoiceId: "b",
        explanation:
          "A session URL works while you are signed in and resolves to nothing for the extractor. The share action gives you the canonical public link, which is what can actually be fetched.",
      },
      {
        id: "saving-2",
        lessonSlug: "how-to-save-a-video",
        prompt:
          "You pick the largest available rendition and the result still looks soft. What happened?",
        choices: [
          { id: "a", text: "The download was compressed on the way through" },
          { id: "b", text: "You need to download it again — the first attempt was truncated" },
          {
            id: "c",
            text: "A larger rendition cannot add detail the original never had; it is a bigger file of the same footage",
          },
          { id: "d", text: "Taking the audio track separately would have preserved the video quality" },
        ],
        correctChoiceId: "c",
        explanation:
          "Resolution is frame size, not detail. If the source was shot in poor light or heavily compressed at capture, every rendition of it carries the same problem at a different file size.",
      },
      {
        id: "saving-3",
        lessonSlug: "what-you-can-and-cannot-download",
        prompt:
          "A video is public, carries no watermark, and you plan to credit the creator by name. May you republish it under your own account?",
        choices: [
          { id: "a", text: "Yes — a public post has no restrictions on reuse" },
          { id: "b", text: "Yes, as long as the original creator is credited" },
          { id: "c", text: "Yes — the absence of a watermark means no rights were claimed" },
          {
            id: "d",
            text: "No — credit is courtesy, not a licence, and copyright is automatic whether or not a notice appears",
          },
        ],
        correctChoiceId: "d",
        explanation:
          "None of public, unwatermarked or credited transfers any right. The questions that matter are whether you made it, whether you have permission, or whether your use is genuine commentary, criticism, news or parody.",
      },
      {
        id: "saving-4",
        lessonSlug: "what-you-can-and-cannot-download",
        prompt: "Which of these is the most clearly legitimate reason to use a downloader?",
        choices: [
          { id: "a", text: "Getting your own work back off a platform you posted it to" },
          { id: "b", text: "Saving a subscriber-only video so you can share it with people who did not pay" },
          { id: "c", text: "Keeping a copy of a private post someone sent to a group you are not in" },
          { id: "d", text: "Removing a creator's watermark so the clip looks like yours" },
        ],
        correctChoiceId: "a",
        explanation:
          "Recovering your own material is one of the strongest uses there is. The other three are the cases the lesson names as never acceptable — redistributing paid content, taking content that was not shared with you, and passing off someone's work as your own.",
      },
    ],
  },
  {
    courseSlug: "creator-workflow",
    title: "Check: building a creator workflow",
    passMark: 0.75,
    questions: [
      {
        id: "workflow-1",
        lessonSlug: "how-to-organise-your-media",
        prompt: "Why begin a filename with the date in year-month-day order?",
        choices: [
          { id: "a", text: "Platforms read it as metadata and use it as the publish date" },
          {
            id: "b",
            text: "It sorts chronologically as plain text in every file browser, with no special support needed",
          },
          { id: "c", text: "It is required for cloud sync to deduplicate files" },
          { id: "d", text: "It prevents two files ever having the same name" },
        ],
        correctChoiceId: "b",
        explanation:
          "Year-month-day is the one date format whose alphabetical order and chronological order are the same. That property is what makes it work everywhere without configuring anything.",
      },
      {
        id: "workflow-2",
        lessonSlug: "how-to-organise-your-media",
        prompt: "Does your download history count as a backup?",
        choices: [
          { id: "a", text: "Yes — everything you have downloaded can be restored from it" },
          { id: "b", text: "Yes, provided you were signed in when you downloaded" },
          {
            id: "c",
            text: "No — it records what you fetched, not the files, and only helps while the source still exists",
          },
          { id: "d", text: "No, but only because it is capped at a fixed number of entries" },
        ],
        correctChoiceId: "c",
        explanation:
          "History is a list of links. If the original post is deleted or made private, the entry remains and the file is gone. Anything you would be upset to lose needs a second copy somewhere physically different.",
      },
      {
        id: "workflow-3",
        lessonSlug: "how-to-build-a-creator-workflow",
        prompt: "When should filing and organising happen?",
        choices: [
          { id: "a", text: "At the moment you save each file, while you remember what it is" },
          { id: "b", text: "Batched on a schedule — deciding per item is where most systems collapse" },
          { id: "c", text: "Only once, when a project is finished" },
          { id: "d", text: "Never; search makes folder structure unnecessary" },
        ],
        correctChoiceId: "b",
        explanation:
          "Capture should never require a decision, or you stop capturing. Everything lands in one inbox and the sorting is a separate, batched job — which is also faster, because you stop paying the cost of switching mode.",
      },
      {
        id: "workflow-4",
        lessonSlug: "how-to-build-a-creator-workflow",
        prompt: "Why does captioning belong before publishing rather than after?",
        choices: [
          { id: "a", text: "Captions cannot be added to a video once it has been uploaded" },
          {
            id: "b",
            text: "Retrofitting them means re-uploading, which costs another encode and resets any engagement",
          },
          { id: "c", text: "Platforms rank uploads that arrive with captions more highly" },
          { id: "d", text: "Caption files expire if they are created after the video" },
        ],
        correctChoiceId: "b",
        explanation:
          "The cost is not the captioning, it is the re-upload it forces. You pay a generation of quality and you throw away whatever reach the first upload had accumulated.",
      },
    ],
  },

  /* --------------------------- Editing School --------------------------- */
  {
    courseSlug: "editing-without-loss",
    title: "Check: editing without losing quality",
    passMark: 0.75,
    questions: [
      {
        id: "editing-1",
        lessonSlug: "how-to-edit-a-clip",
        prompt:
          "A clip has been downloaded, edited, uploaded, downloaded again and re-edited. It now looks soft and blocky while the original still looks fine. Why?",
        choices: [
          { id: "a", text: "Generation loss — codecs are lossy, so each re-encode discards more detail and the losses compound" },
          { id: "b", text: "The resolution is reduced by one step on every upload" },
          { id: "c", text: "Metadata was stripped, so players fall back to a lower-quality decode" },
          { id: "d", text: "Downloading always compresses more heavily than uploading" },
        ],
        correctChoiceId: "a",
        explanation:
          "Every encode throws away detail to save space, and the throwing-away is cumulative. The practical rule follows directly: minimise the number of encodes between source and final upload — edit once, from the best rendition you have, and export once.",
      },
      {
        id: "editing-2",
        lessonSlug: "how-to-edit-a-clip",
        prompt: "What is the trade-off of trimming by stream copy rather than re-encoding?",
        choices: [
          { id: "a", text: "It is frame-accurate but costs you a generation of quality" },
          { id: "b", text: "It preserves the audio but re-encodes the video" },
          {
            id: "c",
            text: "The result is bit-for-bit as good as the source, but cuts land on keyframes so you cannot always cut at an exact frame",
          },
          { id: "d", text: "It only works on clips under a minute" },
        ],
        correctChoiceId: "c",
        explanation:
          "Stream copy keeps the original compressed data and only changes where playback starts and ends. For most social clips the keyframe imprecision is invisible, and the quality it saves is worth far more than frame accuracy.",
      },
      {
        id: "editing-3",
        lessonSlug: "how-to-improve-video-quality",
        prompt: "What does an upscaler actually do to a low-resolution video?",
        choices: [
          { id: "a", text: "Recovers the detail the camera recorded but the compression removed" },
          {
            id: "b",
            text: "Makes the frame larger, inventing plausible detail — inference rather than restoration",
          },
          { id: "c", text: "Corrects poor lighting at capture by re-exposing the frames" },
          { id: "d", text: "Removes compression artefacts by decoding at a higher bit depth" },
        ],
        correctChoiceId: "b",
        explanation:
          "Model-based upscalers hallucinate detail from what they were trained on. It often looks better, and it is still invention — which matters when accuracy matters, because an upscaler can produce something confident and wrong on faces and text.",
      },
      {
        id: "editing-4",
        lessonSlug: "how-to-improve-video-quality",
        prompt:
          "Which looks better: a high resolution at a low bitrate, or a moderate resolution at a generous one?",
        choices: [
          { id: "a", text: "The high resolution — frame size dominates perceived sharpness" },
          {
            id: "b",
            text: "The moderate resolution — the encoder is not being asked to describe more pixels on the same budget",
          },
          { id: "c", text: "They are equivalent; only frame rate distinguishes them" },
          { id: "d", text: "It depends entirely on the display, not on the file" },
        ],
        correctChoiceId: "b",
        explanation:
          "Resolution is frame size; bitrate is how much data describes each second. Raising resolution without raising bitrate spreads the same budget over more pixels, and the encoder has to discard more of each one.",
      },
    ],
  },
  {
    courseSlug: "captions-and-thumbnails",
    title: "Check: captions and thumbnails",
    passMark: 0.75,
    questions: [
      {
        id: "captions-1",
        lessonSlug: "how-to-add-subtitles",
        prompt: "What do sidecar captions give you that burned-in captions cannot?",
        choices: [
          { id: "a", text: "They always appear, on every platform, with no upload path caveats" },
          { id: "b", text: "They cannot be switched off by the viewer" },
          {
            id: "c",
            text: "They are selectable, translatable, indexable by search engines and readable by screen readers",
          },
          { id: "d", text: "They avoid the re-encode that burning in requires" },
        ],
        correctChoiceId: "c",
        explanation:
          "A sidecar file is text, so everything that can be done to text applies. Burned-in captions win on universality — they survive any platform and cannot be turned off — which is why the pragmatic answer for social video is usually both.",
      },
      {
        id: "captions-2",
        lessonSlug: "how-to-add-subtitles",
        prompt: "What goes wrong with captions placed at the very bottom of the frame?",
        choices: [
          { id: "a", text: "Nothing — the bottom is the conventional and safest position" },
          {
            id: "b",
            text: "Platform interface sits there: the caption box, the username and the buttons cover them",
          },
          { id: "c", text: "Players force captions to the top regardless of where you place them" },
          { id: "d", text: "Bottom-positioned captions are excluded from search indexing" },
        ],
        correctChoiceId: "b",
        explanation:
          "Most platforms overlay their own chrome across the lower part of the frame. Watching the clip muted, end to end, on the platform it is going to is the step that catches this — and it is the step people skip.",
      },
      {
        id: "captions-3",
        lessonSlug: "how-to-make-a-thumbnail",
        prompt: "What is the single check that catches most thumbnail problems?",
        choices: [
          { id: "a", text: "Inspect it at full resolution for compression artefacts" },
          { id: "b", text: "Measure the colour contrast ratio in an editor" },
          { id: "c", text: "Shrink it to the size it appears in a feed and look at it there" },
          { id: "d", text: "Compare it against the title text for keyword overlap" },
        ],
        correctChoiceId: "c",
        explanation:
          "Almost every common mistake comes from designing at full size on a large screen. Viewed at feed size, text that is too small, too many focal points, and a subject lost against a busy background all become obvious at once.",
      },
      {
        id: "captions-4",
        lessonSlug: "how-to-make-a-thumbnail",
        prompt: "What does a thumbnail that misrepresents the video actually cost you?",
        choices: [
          { id: "a", text: "Nothing measurable, provided the video itself is good" },
          {
            id: "b",
            text: "One click gained, and the retention that ranking systems actually measure lost",
          },
          { id: "c", text: "Only a manual penalty, and only if a viewer reports it" },
          { id: "d", text: "A lower click-through rate, which is the more damaging of the two signals" },
        ],
        correctChoiceId: "b",
        explanation:
          "Viewers who feel misled leave immediately, and that early drop-off is a far stronger negative signal than a modest click-through rate would have been. The bait wins the click and loses the thing the click was for.",
      },
    ],
  },

  /* -------------------------- Community School -------------------------- */
  {
    courseSlug: "sharing-and-audience",
    title: "Check: sharing and audience",
    passMark: 0.75,
    questions: [
      {
        id: "community-1",
        lessonSlug: "how-feeds-and-friends-work",
        prompt: "How should you think about someone who follows you but is not a friend?",
        choices: [
          { id: "a", text: "As a friend — following and friending are the same relationship" },
          {
            id: "b",
            text: "As a member of the public who has opted in; following is one-directional and you have agreed to nothing",
          },
          { id: "c", text: "As a mutual connection, since following requires acceptance" },
          { id: "d", text: "As someone with access to your friends-only posts" },
        ],
        correctChoiceId: "b",
        explanation:
          "A friend connection is mutual — both people agreed. Following is one-directional: they said they want to see your public posts, and you said nothing about them. Most privacy settings are built on the mutual link, not on followers.",
      },
      {
        id: "community-2",
        lessonSlug: "how-feeds-and-friends-work",
        prompt: "A friend's posts have stopped appearing in your feed. What is the likely explanation?",
        choices: [
          { id: "a", text: "They have blocked you" },
          { id: "b", text: "They deleted the posts" },
          { id: "c", text: "The feed is chronological, so the posts scrolled past overnight" },
          {
            id: "d",
            text: "Ranking — your feed is not a reliable sample of what exists; visiting their profile shows the difference",
          },
        ],
        correctChoiceId: "d",
        explanation:
          "A feed is ranked, not chronological, so absence from it is weak evidence of anything. Going straight to the profile shows everything that person has shared with you, which settles the question in one step.",
      },
      {
        id: "community-3",
        lessonSlug: "how-to-share-without-oversharing",
        prompt: "Order these from narrowest reach to widest.",
        choices: [
          { id: "a", text: "Chat message → story → public post or reel" },
          { id: "b", text: "Story → chat message → public post or reel" },
          { id: "c", text: "Chat message → public post or reel → story" },
          { id: "d", text: "Story → public post or reel → chat message" },
        ],
        correctChoiceId: "a",
        explanation:
          "A chat message reaches that conversation and nobody else. A story reaches your chosen story audience and expires. A post or reel is the widest — on a public account, assume the audience is the public and the lifetime is indefinite.",
      },
      {
        id: "community-4",
        lessonSlug: "how-to-share-without-oversharing",
        prompt: "You are posting something you would not want travelling beyond your own audience. What actually helps?",
        choices: [
          { id: "a", text: "Add a caption asking people not to reshare it" },
          { id: "b", text: "Post it and delete it after a few hours" },
          { id: "c", text: "Turn resharing off at the source, or choose a narrower surface" },
          { id: "d", text: "Post it as a story, since stories expire automatically" },
        ],
        correctChoiceId: "c",
        explanation:
          "Authors control whether their content may be reshared, so use that rather than relying on the goodwill of everyone who sees it. Captions do not travel as reliably as media does, and expiry reduces exposure without undoing it.",
      },
    ],
  },

  /* -------------------- Security & Privacy School ----------------------- */
  {
    courseSlug: "privacy-and-safety-controls",
    title: "Check: privacy and safety controls",
    passMark: 0.75,
    questions: [
      {
        id: "privacy-1",
        lessonSlug: "who-can-see-your-profile",
        prompt: "What does hiding an account change?",
        choices: [
          { id: "a", text: "It narrows the account's reach to friends; the account otherwise works normally" },
          { id: "b", text: "It makes the account fully private, so nobody can see anything" },
          { id: "c", text: "It removes previously published posts" },
          { id: "d", text: "It suspends the account until you reverse it" },
        ],
        correctChoiceId: "a",
        explanation:
          "Hiding is a visibility control, not an enforcement action and not a delete. Your friends see everything as before, nothing you posted is removed, and it is tracked separately from suspension — which stops an account being used at all.",
      },
      {
        id: "privacy-2",
        lessonSlug: "who-can-see-your-profile",
        prompt: "What is the reliable way to find out what a stranger sees on your profile?",
        choices: [
          { id: "a", text: "Read back the privacy settings screen" },
          { id: "b", text: "Open your profile signed out, in a private browsing window" },
          { id: "c", text: "View your own profile while signed in" },
          { id: "d", text: "Assume it matches whatever you last changed" },
        ],
        correctChoiceId: "b",
        explanation:
          "A settings screen tells you what you asked for; the signed-out view tells you what happened. They are not always the same, which is why the check is worth doing after every visibility change rather than once.",
      },
      {
        id: "privacy-3",
        lessonSlug: "blocking-restricting-and-reporting",
        prompt:
          "Someone's behaviour is uncomfortable but not threatening, and you would rather not escalate. Which tool fits?",
        choices: [
          { id: "a", text: "Block — it is the strongest option, so it is the safest default" },
          { id: "b", text: "Report — moderation should decide every awkward situation" },
          {
            id: "c",
            text: "Restrict — it narrows their reach without severing anything, and nothing announces it",
          },
          { id: "d", text: "None of them; wait and see whether it stops on its own" },
        ],
        correctChoiceId: "c",
        explanation:
          "Restricting is the quiet option, which is exactly its value: it does not escalate a situation that escalation would make worse. Blocking is not subtle — someone who suddenly cannot interact with you will usually work out why.",
      },
      {
        id: "privacy-4",
        lessonSlug: "blocking-restricting-and-reporting",
        prompt: "Which of the three involves anyone other than you and the other person?",
        choices: [
          { id: "a", text: "Blocking — the other person is notified that they were blocked" },
          { id: "b", text: "Restricting — it is logged against their account for moderators" },
          { id: "c", text: "All three send a notification of some kind" },
          {
            id: "d",
            text: "Reporting — it is the only one that asks someone else for a decision about the rules",
          },
        ],
        correctChoiceId: "d",
        explanation:
          "Blocking and restricting change your experience. Reporting asks for a judgement about whether something breaks the rules — which is why you report when the behaviour would be a problem regardless of who it happened to. No notification is sent for any of the three.",
      },
    ],
  },

  /* -------------------------- Developer School -------------------------- */
  {
    courseSlug: "building-on-the-api",
    title: "Check: building on the Frenzsave API",
    passMark: 0.75,
    questions: [
      {
        id: "developer-1",
        lessonSlug: "getting-started-with-the-api",
        prompt: "Your mobile app needs data from the API. Where does the API key belong?",
        choices: [
          { id: "a", text: "In the app bundle — it is compiled, so it is not readable" },
          { id: "b", text: "In the browser, sent over HTTPS so it cannot be intercepted" },
          {
            id: "c",
            text: "On your server, in an environment variable; the app calls your backend and your backend calls the API",
          },
          { id: "d", text: "In local storage, so it is scoped to one device" },
        ],
        correctChoiceId: "c",
        explanation:
          "A key shipped in browser JavaScript or a mobile bundle is public the moment it ships, and anyone who reads it can spend your quota. HTTPS protects the transport, not the client. Proxying also lets you apply your own limits.",
      },
      {
        id: "developer-2",
        lessonSlug: "getting-started-with-the-api",
        prompt: "What does POST /v1/analyze return?",
        choices: [
          { id: "a", text: "A download URL for the highest available rendition" },
          { id: "b", text: "The file bytes, streamed" },
          { id: "c", text: "Your remaining quota for the day" },
          {
            id: "d",
            text: "What is actually available — title, duration and the renditions the source offers. No file",
          },
        ],
        correctChoiceId: "d",
        explanation:
          "Analyze inspects without committing, which is why it is the first call in almost every flow: it tells you whether a link resolves at all, and it lets you offer real options instead of guessing which formats exist.",
      },
      {
        id: "developer-3",
        lessonSlug: "handling-rate-limits-and-failures",
        prompt: "A request fails because the post was deleted at the source. What should your client do?",
        choices: [
          { id: "a", text: "Retry with exponential backoff — it may come back" },
          { id: "b", text: "Retry three or four times, then give up" },
          {
            id: "c",
            text: "Fail on the first attempt — a deleted post is permanent, and retrying spends quota to rediscover that",
          },
          { id: "d", text: "Retry indefinitely at a low rate, in case it is restored" },
        ],
        correctChoiceId: "c",
        explanation:
          "Deleted posts, private content and login-gated links are permission boundaries, not blips. Requests count against your quota whether or not they succeed, so a blanket retry can burn a day's allowance discovering that a video is still deleted.",
      },
      {
        id: "developer-4",
        lessonSlug: "handling-rate-limits-and-failures",
        prompt: "Why add random jitter to a backoff delay?",
        choices: [
          { id: "a", text: "It shortens the average wait, so retries complete sooner" },
          {
            id: "b",
            text: "Without it, everything that failed together retries together and rebuilds the spike you were avoiding",
          },
          { id: "c", text: "The API rejects retries that arrive at predictable intervals" },
          { id: "d", text: "It prevents the same file being downloaded twice" },
        ],
        correctChoiceId: "b",
        explanation:
          "Clients that fail at the same moment back off by the same amount and return as a synchronised wave. A small randomisation spreads them out — which is the whole point of backing off in the first place.",
      },
    ],
  },
];

/* ----------------------------------- reads ----------------------------------- */

const BY_COURSE = new Map(ASSESSMENTS.map((a) => [a.courseSlug, a]));

/** Every declared assessment, including any whose course is not teachable. */
export function allAssessments(): Assessment[] {
  return ASSESSMENTS;
}

/**
 * The assessment for a course, if one exists AND its course may be taught.
 *
 * Gated rather than raw: this is what every rendering surface calls, so the
 * truth gate cannot be bypassed by reaching for the record directly. A course
 * with no assessment yet is normal — the corpus grows faster than the checks do,
 * and `uncheckedCourses()` reports the backlog rather than leaving it implicit.
 */
export function getAssessment(courseSlug: string): Assessment | undefined {
  const assessment = BY_COURSE.get(courseSlug);
  if (!assessment) return undefined;
  return teachableCourses().some((c) => c.slug === courseSlug) ? assessment : undefined;
}

/** Assessments whose course may be taught. Sitemaps and admin read this. */
export function teachableAssessments(): Assessment[] {
  const teachable = new Set(teachableCourses().map((c) => c.slug));
  return ASSESSMENTS.filter((a) => teachable.has(a.courseSlug));
}

/**
 * Teachable courses with no self-check written yet — the editorial backlog,
 * surfaced in admin rather than left for someone to notice, exactly as
 * `uncurriculedLessons()` does for lessons outside the curriculum.
 */
export function uncheckedCourses(): string[] {
  return teachableCourses()
    .filter((c) => !BY_COURSE.has(c.slug))
    .map((c) => c.slug);
}

/** Questions in the order the course teaches their lessons, then declaration order. */
export function orderedQuestions(courseSlug: string): Question[] {
  const assessment = getAssessment(courseSlug);
  const course = getCourse(courseSlug);
  if (!assessment || !course) return [];

  const lessonOrder = new Map(course.lessonSlugs.map((slug, i) => [slug, i]));
  return [...assessment.questions].sort(
    (a, b) => (lessonOrder.get(a.lessonSlug) ?? 0) - (lessonOrder.get(b.lessonSlug) ?? 0),
  );
}

/* ---------------------------------- grading ---------------------------------- */

/**
 * Grade a set of answers. Pure, synchronous and total.
 *
 * Unanswered questions are graded as wrong rather than rejected. Refusing to
 * grade a partial attempt would mean a reader who skipped one question gets
 * nothing back — no explanations, no review list — which withholds the useful
 * part of the exercise over a technicality about completeness.
 */
export function gradeAssessment(
  courseSlug: string,
  chosen: Readonly<Record<string, string | null>>,
): AssessmentResult | null {
  const assessment = getAssessment(courseSlug);
  if (!assessment) return null;

  const questions = orderedQuestions(courseSlug);

  const answers: GradedAnswer[] = questions.map((question) => {
    const chosenChoiceId = chosen[question.id] ?? null;
    return {
      questionId: question.id,
      chosenChoiceId,
      correct: chosenChoiceId === question.correctChoiceId,
      lessonSlug: question.lessonSlug,
      lessonHref: `/learn/${question.lessonSlug}`,
    };
  });

  const score = answers.filter((a) => a.correct).length;

  /*
    Review lessons keep the course's teaching order, not the order the reader
    happened to get things wrong in — someone sent back to two lessons should
    reread them in the order they were meant to be read.
  */
  const wrong = new Set(answers.filter((a) => !a.correct).map((a) => a.lessonSlug));
  const course = getCourse(courseSlug);
  const reviewLessonSlugs = (course?.lessonSlugs ?? []).filter((slug) => wrong.has(slug));

  return {
    courseSlug,
    answers,
    score,
    total: questions.length,
    passed: questions.length > 0 && score / questions.length >= assessment.passMark,
    reviewLessonSlugs,
  };
}

/**
 * How many questions a course's check has — 0 when it has none.
 *
 * Exists so a SERVER component can render the disclosure ("Check your
 * understanding · 4 questions") without the client island having to import this
 * module to count them. That import is the whole cost: measured on the build,
 * pulling the corpus into `/academy/[school]` took its first-load JS from 260 kB
 * to 275 kB — 15 kB shipped to every reader of a static content page for a quiz
 * most of them will not open. The count crosses as a prop; the prose crosses
 * only when someone actually opens the check.
 */
export function assessmentQuestionCount(courseSlug: string): number {
  return getAssessment(courseSlug)?.questions.length ?? 0;
}

/** Course slugs that have a check, for surfaces that only need to know "is there one". */
export const CHECKED_COURSE_SLUGS: string[] = COURSES.filter((c) => BY_COURSE.has(c.slug)).map(
  (c) => c.slug,
);
