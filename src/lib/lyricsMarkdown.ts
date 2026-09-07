/**
 * Fast View's lyrics mini-markdown (RH-51).
 *
 * Pure: no DOM, no React, no data access, so it runs in the default `node` test
 * environment. Extracted from the Fast View page, where it was a module-level
 * helper that had never had a test of its own.
 */

/**
 * The Fast View lyrics mini-markdown, rendered to HTML.
 *
 * The three escapes run FIRST and in this order (`&` before `<` and `>`), so
 * user text can never introduce markup and an escaped entity can never be
 * double-escaped. Everything emitted afterwards is markup this function chose.
 */
export function parseLyricsMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([\s\S]*?)\*/g, '<em>$1</em>')
    .replace(/__([\s\S]*?)__/g, '<u>$1</u>')
    .replace(/\[(.*?)\]/g, '<strong class="text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100 text-xs font-semibold select-all">$1</strong>')
}
