"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, INPUT, ListInput, SaveMessage, TEXTAREA } from "@/features/profile/platform-fields";
import type { OpeningHours, ProfileDetails } from "@/lib/social/profile-platform";
import { cn } from "@/lib/utils";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const AVAILABILITY = [
  { value: "open", label: "Open to work" },
  { value: "selective", label: "Open to the right thing" },
  { value: "unavailable", label: "Not available" },
];

/**
 * The singular half of a profile — what the About, Skills, Hours & location and
 * Résumé modules read (Feature 18 · Part 14, migration 0107).
 *
 * `section` decides which half is edited. Only the fields on screen are sent,
 * so the Business screen can never blank the Professional screen's answers and
 * vice versa — the API writes exactly the keys it receives.
 */
export function ProfileDetailsEditor({
  section,
  details,
}: {
  section: "business" | "professional";
  details: ProfileDetails;
}) {
  const router = useRouter();
  const [v, setV] = useState(details);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof ProfileDetails>(key: K, value: ProfileDetails[K]) =>
    setV((s) => ({ ...s, [key]: value }));

  const hoursFor = (day: number): OpeningHours =>
    v.hours.find((h) => h.day === day) ?? { day, open: "09:00", close: "17:00", closed: true };

  const setHours = (day: number, patch: Partial<OpeningHours>) => {
    const next = [...v.hours.filter((h) => h.day !== day), { ...hoursFor(day), ...patch }].sort(
      (a, b) => a.day - b.day,
    );
    set("hours", next);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const body =
      section === "business"
        ? {
            headline: v.headline,
            category: v.category,
            mission: v.mission,
            founded: v.founded,
            team_size: v.teamSize,
            contact_email: v.contactEmail,
            contact_phone: v.contactPhone,
            booking_url: v.bookingUrl,
            quote_url: v.quoteUrl,
            address: v.address,
            city: v.city,
            country: v.country,
            hours: v.hours,
          }
        : {
            headline: v.headline,
            category: v.category,
            mission: v.mission,
            availability: v.availability,
            skills: v.skills,
            languages: v.languages,
            resume_url: v.resumeUrl,
          };
    try {
      const res = await fetch("/api/profile/details", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Couldn't save." });
        return;
      }
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label={section === "business" ? "Tagline" : "Headline"} hint="One line under your name.">
        <input
          className={INPUT}
          value={v.headline ?? ""}
          maxLength={120}
          onChange={(e) => set("headline", e.target.value)}
          placeholder={section === "business" ? "Speciality coffee, roasted in Lagos" : "Product designer · Interfaces & systems"}
        />
      </Field>

      <Field label={section === "business" ? "Industry" : "Field"}>
        <input
          className={INPUT}
          value={v.category ?? ""}
          maxLength={60}
          onChange={(e) => set("category", e.target.value)}
          placeholder={section === "business" ? "Food & drink" : "Design"}
        />
      </Field>

      <Field
        label={section === "business" ? "About the business" : "About your work"}
        hint="The longer version — what you do and who it's for."
      >
        <textarea
          className={TEXTAREA}
          value={v.mission ?? ""}
          maxLength={1000}
          onChange={(e) => set("mission", e.target.value)}
        />
      </Field>

      {section === "professional" ? (
        <>
          <Field label="Availability">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => set("availability", null)}
                aria-pressed={!v.availability}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                  !v.availability ? "bg-brand-tile text-white shadow-sm" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
                )}
              >
                Don&apos;t say
              </button>
              {AVAILABILITY.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => set("availability", a.value)}
                  aria-pressed={v.availability === a.value}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    v.availability === a.value
                      ? "bg-brand-tile text-white shadow-sm"
                      : "bg-secondary/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Skills" hint="Separate with commas.">
            <ListInput value={v.skills} onChange={(skills) => set("skills", skills)} placeholder="Figma, Design systems, Research" />
          </Field>

          <Field label="Languages" hint="Separate with commas.">
            <ListInput value={v.languages} onChange={(languages) => set("languages", languages)} placeholder="English, Yoruba, French" />
          </Field>

          <Field label="Résumé link" hint="A public link to your full CV.">
            <input
              className={INPUT}
              value={v.resumeUrl ?? ""}
              onChange={(e) => set("resumeUrl", e.target.value)}
              inputMode="url"
              placeholder="https://…"
            />
          </Field>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Founded">
              <input className={INPUT} value={v.founded ?? ""} maxLength={40} onChange={(e) => set("founded", e.target.value)} placeholder="2019" />
            </Field>
            <Field label="Team size">
              <input className={INPUT} value={v.teamSize ?? ""} maxLength={40} onChange={(e) => set("teamSize", e.target.value)} placeholder="12 people" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact email">
              <input className={INPUT} value={v.contactEmail ?? ""} onChange={(e) => set("contactEmail", e.target.value)} inputMode="email" placeholder="hello@business.com" />
            </Field>
            <Field label="Phone">
              <input className={INPUT} value={v.contactPhone ?? ""} maxLength={40} onChange={(e) => set("contactPhone", e.target.value)} inputMode="tel" placeholder="+234…" />
            </Field>
          </div>

          <Field label="Booking link" hint="Powers the “Book appointment” button on your profile.">
            <input className={INPUT} value={v.bookingUrl ?? ""} onChange={(e) => set("bookingUrl", e.target.value)} inputMode="url" placeholder="https://…" />
          </Field>

          <Field label="Quote link" hint="Powers “Request a quote”.">
            <input className={INPUT} value={v.quoteUrl ?? ""} onChange={(e) => set("quoteUrl", e.target.value)} inputMode="url" placeholder="https://…" />
          </Field>

          <Field label="Address">
            <input className={INPUT} value={v.address ?? ""} maxLength={200} onChange={(e) => set("address", e.target.value)} placeholder="12 Marina Road" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City">
              <input className={INPUT} value={v.city ?? ""} maxLength={80} onChange={(e) => set("city", e.target.value)} placeholder="Lagos" />
            </Field>
            <Field label="Country">
              <input className={INPUT} value={v.country ?? ""} maxLength={80} onChange={(e) => set("country", e.target.value)} placeholder="Nigeria" />
            </Field>
          </div>

          <Field label="Opening hours" hint="Leave a day closed if you don't open.">
            <div className="space-y-1.5">
              {DAYS.map((name, day) => {
                const h = hoursFor(day);
                return (
                  <div key={name} className="flex items-center gap-2 rounded-xl bg-secondary/30 px-2.5 py-2">
                    <span className="w-20 shrink-0 text-xs font-semibold">{name.slice(0, 3)}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!h.closed}
                      aria-label={`${name} open`}
                      onClick={() => setHours(day, { closed: !h.closed })}
                      className={cn(
                        "relative h-5 w-9 shrink-0 rounded-full transition",
                        !h.closed ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
                      )}
                    >
                      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", !h.closed ? "left-[18px]" : "left-0.5")} />
                    </button>
                    {h.closed ? (
                      <span className="text-xs text-muted-foreground">Closed</span>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <input
                          type="time"
                          value={h.open}
                          onChange={(e) => setHours(day, { open: e.target.value })}
                          aria-label={`${name} opens`}
                          className="h-8 min-w-0 flex-1 rounded-lg bg-background px-2 text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <input
                          type="time"
                          value={h.close}
                          onChange={(e) => setHours(day, { close: e.target.value })}
                          aria-label={`${name} closes`}
                          className="h-8 min-w-0 flex-1 rounded-lg bg-background px-2 text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Field>
        </>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={() => void save()} disabled={busy} className="btn-lux btn-lux-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
        </button>
      </div>
      <SaveMessage msg={msg} />
    </div>
  );
}
