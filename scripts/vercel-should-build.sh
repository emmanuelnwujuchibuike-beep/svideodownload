#!/usr/bin/env bash
#
# Vercel "Ignored Build Step".
#
# ── Why this exists ───────────────────────────────────────────────────────────
# Build CPU Minutes is by far the largest line on this project's Vercel bill —
# roughly 60% of spend, against $0.28 of function invocations. The app is not
# expensive to RUN; it is expensive to BUILD, and it rebuilds on every push to
# main. A push that changes only documentation produces a byte-identical
# deployment and costs a full build.
#
# ── Exit codes (Vercel's convention, easy to get backwards) ───────────────────
#   exit 0 → SKIP the build
#   exit 1 → BUILD
#
# ── Fails toward BUILDING, always ─────────────────────────────────────────────
# Every uncertain path exits 1. A wrongly-skipped build means a real change
# silently never reaches production, which is far worse than paying for one
# unnecessary build — so this only ever skips when it is CERTAIN that nothing
# shippable changed. If git can't answer (a shallow clone with no parent, a
# first deploy, a force-push), it builds.
#
# ── What counts as "not shippable" ────────────────────────────────────────────
# Only prose that is never imported, compiled, or served:
#   docs/**            — internal design notes
#   *.md at any depth  — READMEs, AGENTS.md, CLAUDE.md
#   .claude/**         — assistant configuration
# Everything else — source, config, public/, supabase/, scripts/, tests — builds.
# Tests are deliberately NOT exempt: they gate the build.

set -uo pipefail

# No parent commit to compare against (first deploy, shallow clone) → build.
if ! git rev-parse HEAD^ >/dev/null 2>&1; then
  echo "No parent commit to diff against — building."
  exit 1
fi

changed="$(git diff --name-only HEAD^ HEAD 2>/dev/null)" || {
  echo "Could not read the diff — building to be safe."
  exit 1
}

# An empty diff is unexpected (an empty commit, a merge we can't read) → build.
if [ -z "$changed" ]; then
  echo "Empty diff — building to be safe."
  exit 1
fi

while IFS= read -r file; do
  [ -z "$file" ] && continue
  case "$file" in
    docs/*|.claude/*|*.md) ;;      # prose only — keep checking
    *)
      echo "Shippable change detected ($file) — building."
      exit 1
      ;;
  esac
done <<< "$changed"

echo "Only documentation changed — skipping this build."
exit 0
