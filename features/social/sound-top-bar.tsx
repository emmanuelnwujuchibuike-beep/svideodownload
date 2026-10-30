"use client";

import { ArrowLeft, Music2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/** The sound page's top bar — design/frenz-sounds.html's round buttons: back, and the Sounds library. */
export function SoundTopBar() {
  const router = useRouter();
  return (
    <div className="flex items-center justify-between px-5 pb-3 pt-5">
      <button type="button" aria-label="Back" onClick={() => (window.history.length > 1 ? router.back() : router.push("/sounds"))} className="flex h-12 w-12 items-center justify-center rounded-full bg-frenz-fill transition active:scale-95">
        <ArrowLeft className="h-[22px] w-[22px]" />
      </button>
      <Link href="/sounds" aria-label="All sounds" className="flex h-12 w-12 items-center justify-center rounded-full bg-frenz-fill transition active:scale-95">
        <Music2 className="h-5 w-5" />
      </Link>
    </div>
  );
}
