/**
 * Fast View's lyrics mini-markdown (RH-51).
 *
 * Pure: no DOM, no React, no data access, so it runs in the default `node` test
 * environment. Extracted from the Fast View page, where it was a module-level
 * helper that had never had a test of its own.
 */

/**
 * One formatting rule of the lyrics mini-markdown (RH-94).
 *
 * The parser applies these rows and the editor's formatting guide lists them,
 * so the two can never disagree about which formats exist or in which order.
 */
interface LyricsFormatRule {
  id: string
  label: string
  syntax: string
  pattern: RegExp
  replacement: string
}

/**
 * The formatting rules, in parse order. Bold MUST run before italic, or a
 * `**run**` would be consumed as two empty italic runs.
 */
const LYRICS_FORMAT_RULES: readonly LyricsFormatRule[] = [
  { id: 'bold', label: 'Bold', syntax: '**bold**', pattern: /\*\*([\s\S]*?)\*\*/g, replacement: '<strong>$1</strong>' },
  { id: 'italic', label: 'Italic', syntax: '*italic*', pattern: /\*([\s\S]*?)\*/g, replacement: '<em>$1</em>' },
  { id: 'underline', label: 'Underline', syntax: '__underline__', pattern: /__([\s\S]*?)__/g, replacement: '<u>$1</u>' },
  {
    id: 'badge',
    label: 'Chord / cue badge',
    syntax: '[Am]',
    pattern: /\[(.*?)\]/g,
    replacement:
      '<strong class="text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100 text-xs font-semibold select-all">$1</strong>',
  },
]

/**
 * The Fast View lyrics mini-markdown, rendered to HTML.
 *
 * The three escapes run FIRST and in this order (`&` before `<` and `>`), so
 * user text can never introduce markup and an escaped entity can never be
 * double-escaped. Everything emitted afterwards is markup this function chose,
 * one formatting rule at a time in table order.
 */
export function parseLyricsMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return LYRICS_FORMAT_RULES.reduce((html, rule) => html.replace(rule.pattern, rule.replacement), escaped)
}

/** One row of the editor's formatting guide: what to type and what it renders to. */
export interface LyricsFormatGuideEntry {
  id: string
  label: string
  syntax: string
  previewHtml: string
}

/**
 * The formatting guide shown beside the lyrics editor, one entry per rule in
 * parse order. Each preview is the parser's own output for the example syntax.
 */
export function lyricsFormatGuide(): LyricsFormatGuideEntry[] {
  return LYRICS_FORMAT_RULES.map(({ id, label, syntax }) => ({
    id,
    label,
    syntax,
    previewHtml: parseLyricsMarkdown(syntax),
  }))
}
