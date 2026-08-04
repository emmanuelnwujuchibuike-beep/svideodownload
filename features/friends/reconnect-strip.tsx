import { MessageCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import type { GraphConnection } from "@/lib/social/graph/overview";

/**
 * "Been a while" — reconnect suggestions (Part 17).
 *
 * A server component with no client JavaScript: it is a list of links.
 *
 * The rules that decide WHO appears live in `shouldSuggestReconnect`, and they
 * are strict on purpose — only agreed friendships, only people you have
 * actually talked to before, only after a long silence, and never anyone you
 * muted or restricted. The strip is silent far more often than it is not, which
 * is what stops it becoming another prompt to ignore.
 */
export function ReconnectStrip({ items }: { items: GraphConnection[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="reconnect-heading">
      <h2 id="reconnect-heading" className="mb-2 px-0.5 text-sm font-bold">
        Been a while
      </h2>
      <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((c) => (
          <li key={c.user.id} className="w-40 shrink-0">
            <div className="flex h-full flex-col items-center gap-2 rounded-2xl border border-border/70 bg-card px-3 py-3.5 text-center shadow-sm">
              <span className="relative h-12 w-12 overflow-hidden rounded-full bg-secondary">
                {c.user.avatarUrl ? (
                  <Image src={c.user.avatarUrl} alt="" fill sizes="48px" className="object-cover" />
                ) : null}
              </span>
              <span className="min-w-0">
                <Link
                  href={`/u/${c.user.handle}`}
                  prefetch={false}
                  className="block truncate text-sm font-semibold hover:underline"
                >
                  {c.user.displayName}
                </Link>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {c.label ?? `Friends since ${new Date(c.since).getFullYear()}`}
                </span>
              </span>
              <Link
                href={`/messages?to=${c.user.handle}`}
                prefetch={false}
                className="mt-auto inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[11px] font-semibold transition hover:bg-primary hover:text-white"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Say hello
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
