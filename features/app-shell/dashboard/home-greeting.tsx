"use client";

import { useEffect, useState } from "react";

function partOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

export function HomeGreeting({ name }: { name: string }) {
  const [tod, setTod] = useState("day");
  useEffect(() => setTod(partOfDay()), []);
  return (
    <div className="pt-1">
      <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-foreground sm:text-3xl">
        Good {tod}, {name} 👋
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">What do you want to watch or download today?</p>
    </div>
  );
}
