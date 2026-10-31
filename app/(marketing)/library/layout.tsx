import type { ReactNode } from "react";

// the entry stylesheet for this section (2026-10-31: the shared marketing layout carries none — see app/(marketing)/layout.tsx)
import "../../entry.css";

export default function LibraryLayout({ children }: { children: ReactNode }) {
  return children;
}
