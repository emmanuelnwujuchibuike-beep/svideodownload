"use client";

import { startAuthentication } from "@simplewebauthn/browser";

/**
 * Runs a full passkey step-up ceremony (options → browser prompt → verify)
 * for the given purpose. Returns true only once the server has issued the
 * short-lived `frenz_stepup` cookie — see lib/security/stepup.ts.
 */
export async function requestPasskeyStepUp(purpose: string): Promise<boolean> {
  try {
    const optionsRes = await fetch("/api/v1/app/security/passkeys/stepup/options", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose }),
    });
    const optionsJson = await optionsRes.json();
    if (!optionsJson.ok) return false;

    const assertion = await startAuthentication({ optionsJSON: optionsJson.data.options });

    const verifyRes = await fetch("/api/v1/app/security/passkeys/stepup/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ response: assertion, purpose }),
    });
    const verifyJson = await verifyRes.json();
    return !!verifyJson.ok && !!verifyJson.data?.ok;
  } catch {
    // Includes the user cancelling the OS biometric prompt — a normal,
    // silent "no" rather than an error to surface.
    return false;
  }
}

export async function hasEnrolledPasskeys(): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/app/security/passkeys");
    const json = await res.json();
    return json.ok && Array.isArray(json.data.passkeys) && json.data.passkeys.length > 0;
  } catch {
    return false;
  }
}
