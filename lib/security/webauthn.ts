import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import { SITE_URL } from "@/lib/site";

/**
 * WebAuthn passkeys used as a STEP-UP verification gate (Part 11a) — NOT a
 * primary-login replacement. Supabase Auth has no native WebAuthn factor
 * type, and minting a session from a custom-verified assertion would need
 * a bespoke session-issuance path assessed as too risky for this round.
 * `userVerification: "required"` throughout is what makes this a genuine
 * biometric gate (FaceID/TouchID/Windows Hello) rather than a bare
 * possession check.
 */
export function rpConfig() {
  const rpID = process.env.WEBAUTHN_RP_ID || new URL(SITE_URL).hostname;
  return { rpID, rpName: "Frenzsave", origin: SITE_URL };
}

export async function buildRegistrationOptions(
  userId: string,
  userEmail: string,
  existing: { credential_id: string; transports: string[] | null }[],
) {
  const { rpID, rpName } = rpConfig();
  return generateRegistrationOptions({
    rpName,
    rpID,
    userName: userEmail,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
  });
}

export async function verifyRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<VerifiedRegistrationResponse> {
  const { rpID, origin } = rpConfig();
  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
}

export async function buildStepUpOptions(
  credentials: { credential_id: string; transports: string[] | null }[],
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = rpConfig();
  return generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: credentials.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
  });
}

export async function verifyStepUp(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  credential: { credential_id: string; public_key: Buffer; counter: number; transports: string[] | null },
): Promise<VerifiedAuthenticationResponse> {
  const { rpID, origin } = rpConfig();
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: credential.credential_id,
      // Buffer is backed by a real ArrayBuffer here (fromBytea's Buffer.from(hex,
      // "hex") never allocates a SharedArrayBuffer) — @types/node's Buffer typing
      // just isn't narrowed enough for the library's stricter Uint8Array<ArrayBuffer>.
      publicKey: credential.public_key as unknown as Uint8Array<ArrayBuffer>,
      counter: credential.counter,
      transports: (credential.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    },
  });
}

/** Clone/replay detection: reject if the authenticator reports a counter
 *  that hasn't advanced, UNLESS it's one of the many platform authenticators
 *  (Face ID/Touch ID/Windows Hello) that always report 0 — a real, accepted
 *  trade-off, not an oversight. */
export function counterLooksReplayed(storedCounter: number, newCounter: number): boolean {
  if (storedCounter === 0 && newCounter === 0) return false;
  return newCounter <= storedCounter;
}
