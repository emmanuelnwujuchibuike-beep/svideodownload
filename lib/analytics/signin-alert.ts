import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { alertEmailHtml, sendAdminEmail } from "@/lib/notify";
import { SITE_URL } from "@/lib/site";
import { resolveAdminUserIds } from "@/lib/support/chat";

/**
 * Notify every admin — push AND email — that a user just signed in, with their
 * details (owner: "let admin receive push notification and email on every user
 * that signed in, and their details and everything"). Reuses the same admin-fanout
 * the Support inbox uses. Best-effort; never throws into the caller.
 */
export interface SignInDetails {
  name: string;
  handle: string | null;
  email: string | null;
  plan: string;
  country: string | null;
  city: string | null;
  device: string;
  browser: string;
  os: string;
  when: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function notifyAdminsOfSignIn(d: SignInDetails): Promise<void> {
  const where = [d.city, d.country].filter(Boolean).join(", ");

  // Push to every admin.
  try {
    const adminIds = await resolveAdminUserIds();
    await Promise.all(
      adminIds.map((id) =>
        sendSmartPush(
          id,
          {
            title: `Sign-in · ${d.name}`,
            body: `${d.handle ? `@${d.handle} · ` : ""}${d.plan}${where ? ` · ${where}` : ""} · ${d.device}/${d.browser}`,
            url: `${SITE_URL}/admin`,
            tag: "signin",
          },
          "high",
          "system",
          // A sign-in IS a security event, and typing it as one is what makes the
          // stored copy open the security surface when tapped.
          { type: "security_login" },
        ).catch(() => {}),
      ),
    );
  } catch {
    /* push is best-effort */
  }

  // Email the admin inbox.
  try {
    await sendAdminEmail(
      `New sign-in: ${d.name}`,
      alertEmailHtml({
        heading: "A user signed in",
        intro: `${esc(d.name)} just signed in to FrenzSave.`,
        rows: [
          { label: "Name", value: esc(d.name) },
          { label: "Handle", value: d.handle ? `@${esc(d.handle)}` : "—" },
          { label: "Email", value: d.email ? esc(d.email) : "—" },
          { label: "Plan", value: esc(d.plan) },
          { label: "Location", value: esc(where || "Unknown") },
          { label: "Device", value: esc(`${d.device} · ${d.browser} · ${d.os}`) },
          { label: "When", value: esc(d.when) },
        ],
        footnote: "FrenzSave · Sign-in alerts",
      }),
    );
  } catch {
    /* email is best-effort */
  }
}
