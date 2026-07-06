/**
 * Serialize structured data (JSON-LD) for embedding in a <script> tag.
 *
 * Plain JSON.stringify is NOT safe there: it doesn't escape `<`, so any
 * user-controlled string containing `</script><script>…` would terminate the
 * JSON-LD block and execute as markup (stored XSS on post/profile pages,
 * where titles and bios feed the schema). Escaping `<`, `>` and `&` to their
 * \uXXXX forms keeps the payload inert while remaining valid JSON that
 * search engines parse identically.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
