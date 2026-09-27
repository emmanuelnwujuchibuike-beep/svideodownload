import { z } from "zod";

/**
 * The bodies the Voice Cloning routes accept. Strict: an unknown field does
 * not parse, so nothing a client invents reaches a handler. The ceilings here
 * are the SCHEMA's (a body cannot be absurd); the operator's ceilings
 * (config.samples.*) are applied after, and the real files are measured in
 * storage before a provider is asked for anything.
 */
const voiceName = z.string().trim().min(1).max(60);
const fileName = z.string().trim().min(1).max(200);
const mime = z.string().trim().min(1).max(120);

/**
 * One sample the browser is about to upload. `durationMs` is what an
 * `<audio>` element measured and is ADVISORY — there is no ffmpeg on the
 * frontend and this tool deliberately does not involve the worker, so the
 * enforced ceilings are the count and the bytes, both of which storage
 * reports for itself. The duration exists so the interface can refuse two
 * seconds of audio before an upload rather than after a charge.
 */
export const voiceCloneSampleFacts = z
  .object({
    name: fileName,
    mimeType: mime,
    size: z.number().int().positive().max(50 * 1024 * 1024),
    durationMs: z.number().int().positive().max(60 * 60 * 1000).nullable().optional(),
  })
  .strict();

export const createVoiceCloneJobSchema = z
  .object({
    clientRequestId: z.string().min(8).max(100),
    name: voiceName,
    description: z.string().trim().max(300).optional(),
    /** 1–25 here; the operator's own maximum is applied after. */
    samples: z.array(voiceCloneSampleFacts).min(1).max(25),
  })
  .strict();
export type CreateVoiceCloneJobRequest = z.infer<typeof createVoiceCloneJobSchema>;

/**
 * ── 🔴 THE CONSENT IS PART OF THE START BODY, NOT A CHECKBOX SOMEWHERE ──────
 *
 * `consent: true` is a LITERAL: a body without it does not parse, so there is
 * no code path — not a retry, not an internal caller, not a future script —
 * that can create a clone without the member having agreed. `consentName` is
 * the signature they typed; the server checks it against the operator's
 * requirement and stores it with the words they were shown.
 *
 * This is the one place this product asks for a typed confirmation. A cloned
 * voice is a person's likeness, and "they clicked through a dialog" is not a
 * record anybody can stand behind later.
 */
export const startVoiceCloneJobSchema = z
  .object({
    consent: z.literal(true),
    consentName: z.string().trim().max(120).optional(),
    /** What the member was shown; Start recomputes and refuses a difference (PRICE_CHANGED). */
    quote: z.object({ totalCents: z.number().int().nonnegative(), pricingConfigVersion: z.number().int().positive() }).strict().optional(),
    funding: z.enum(["credits", "wallet"]).optional(),
  })
  .strict();
export type StartVoiceCloneJobRequest = z.infer<typeof startVoiceCloneJobSchema>;

export const renameVoiceCloneSchema = z.object({ name: voiceName, description: z.string().trim().max(300).optional() }).strict();
