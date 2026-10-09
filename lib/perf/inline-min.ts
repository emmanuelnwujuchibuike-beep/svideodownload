/**
 * Squeezes a hand-written inline <script>/<style> string before it is put in
 * the document (Download page refinement, 2026-10-09: "less weight, cold entry
 * under 2 s").
 *
 * Inline code in the root layout ships TWICE on every cold page — once as the
 * tag, and again inside the RSC payload React streams beside it — and these
 * strings carried their full explanatory comments into both copies. The source
 * keeps every comment; only the bytes sent drop.
 *
 * Deliberately conservative, because there is no parser here: it removes
 * BLOCK comments, then trims each line and drops blank ones. It never touches
 * `//` (it could be inside a string or a URL) and never joins lines (a JS line
 * break can be load-bearing via ASI). Callers must not put `/*` or `*\/` inside
 * a string or regex literal — inline-min.test.ts parses the result to prove it.
 * Runs once per module load on the server, not per request.
 */
export function minifyInline(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
