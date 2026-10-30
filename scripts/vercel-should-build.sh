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
# Only files that are never imported, compiled, or served by the deployment:
#   docs/**            — internal design notes
#   *.md at any depth  — READMEs, AGENTS.md, CLAUDE.md
#   .claude/**         — assistant configuration
#   *.test.ts(x)       — see below
# Everything else — source, config, public/, supabase/, scripts/ — builds.
#
# ── 🔴 TESTS WERE EXEMPTED ON 2026-10-05, AND THE OLD REASONING WAS WRONG ─────
#
# This file used to say: "Tests are deliberately NOT exempt: they gate the
# build." They do not. `next build` does not run vitest — CI does, before the
# push — and Next does not typecheck test files either. A commit touching only
# `*.test.ts` therefore produces a BYTE-IDENTICAL deployment and was paying for
# a full build to produce it.
#
# That is not theoretical. Build CPU Minutes is the largest line on this
# project's bill, and a day of test-only commits is a day of builds that ship
# nothing. The owner's standing rule names this exact case: "A build on a
# commit that cannot change the deployment."
#
# ⚠️ The safety argument still holds in the other direction: skipping a build
# can never hide a broken test, because the tests do not run here. What catches
# a broken test is CI and the four local gates — which is where it belongs.

set -uo pipefail

# ── 🔴 ONLY main EVER BUILDS (owner, 2026-10-30) ───────────────────────────────
#
# "Any branch other than main never builds." Every push to another branch (ui-redesign, a feature branch) started its
# own PREVIEW build at full price — and work pushed to a branch AND to main paid for two builds of the same commit.
# Production is main; nothing else is deployed. A branch Vercel NAMES and that is not main is skipped. An UNKNOWN branch
# (no VERCEL_GIT_COMMIT_REF, e.g. a manual redeploy) is not skipped here — it falls through to the rules below, which
# fail toward building.
branch="${VERCEL_GIT_COMMIT_REF:-}"
if [ -n "$branch" ] && [ "$branch" != "main" ]; then
  echo "Branch '${branch}' is not main — skipping: only main builds."
  exit 0
fi

# ── 🔴 COMPARE WITH THE LAST DEPLOYED COMMIT, NOT JUST THE LAST COMMIT (2026-10-23) ──
#
# This diffed HEAD^..HEAD — only the push's LAST commit. A push of 13 commits whose last one
# touched only a test file was skipped as "only documentation", and the other 12 (all code)
# never reached production. Vercel hands this step the commit of the last successful
# deployment for the branch (VERCEL_GIT_PREVIOUS_SHA); everything since THAT is what ships.
# Unknown, or not in the clone (a shallow clone, a first deploy, a force-push) → build.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$base" ]; then
  echo "No previous deployment commit given — building."
  exit 1
fi
if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "Previous deployment commit ${base} is not in this clone — building."
  exit 1
fi

changed="$(git diff --name-only "$base" HEAD 2>/dev/null)" || {
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
    # Not served, not compiled into the deployment, not run by `next build`.
    docs/*|.claude/*|*.md|*.test.ts|*.test.tsx|*.test.mjs) ;;
    *)
      echo "Shippable change detected ($file) — building."
      exit 1
      ;;
  esac
done <<< "$changed"

echo "Only documentation changed — skipping this build."
exit 0
