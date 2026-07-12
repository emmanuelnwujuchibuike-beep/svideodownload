import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client bound to the request cookies. Use in Server
 * Components, Route Handlers and Server Actions. RLS is enforced via the
 * authenticated user's JWT.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore; middleware
            // refreshes the session cookie on navigation.
          }
        },
      },
    },
  );
}

/**
 * `auth.getUser()` with a hard time-box, for SERVER PAGES on the render
 * critical path. The un-time-boxed call sits between the request and the
 * page's loading.tsx skeleton resolving — a stalled socket to Supabase's
 * auth endpoint held pages on their skeleton indefinitely (the "stuck at
 * loading" symptom; full trace in docs/STARTUP_AUDIT.md).
 *
 * The three outcomes are deliberately DISTINCT so a slow network never
 * masquerades as "signed out": `user` (proceed), `signed-out` (redirect to
 * login), `timeout` (render the page's Retry state — do NOT redirect).
 */
export async function getUserBounded(
  supabase: Awaited<ReturnType<typeof createClient>>,
  timeoutMs = 6000,
): Promise<{ kind: "user"; user: User } | { kind: "signed-out" } | { kind: "timeout" }> {
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("auth timeout")), timeoutMs)),
    ]);
    return result.data.user ? { kind: "user", user: result.data.user } : { kind: "signed-out" };
  } catch {
    return { kind: "timeout" };
  }
}
