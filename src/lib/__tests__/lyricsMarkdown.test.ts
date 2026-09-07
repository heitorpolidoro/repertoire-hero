import { describe, it, expect } from 'vitest'
import { parseLyricsMarkdown } from '@/lib/lyricsMarkdown'

/** The chord badge markup, transcribed from the Fast View page it came from. */
const CHORD_CLASS =
  'text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100 text-xs font-semibold select-all'

describe('lyricsMarkdown', () => {
  it('parseLyricsMarkdown escapes an ampersand before any markup is emitted', () => {
    expect(parseLyricsMarkdown('Simon & Garfunkel')).toBe('Simon &amp; Garfunkel')
    // `&` is escaped first, so the entity the next rules emit is never
    // double-escaped: a literal `<` becomes `&lt;`, not `&amp;lt;`.
    expect(parseLyricsMarkdown('<')).toBe('&lt;')
  })

  it('parseLyricsMarkdown escapes a less-than sign so raw HTML stays inert', () => {
    expect(parseLyricsMarkdown('a < b')).toBe('a &lt; b')
    expect(parseLyricsMarkdown('</div>')).not.toContain('</div>')
  })

  it('parseLyricsMarkdown escapes a greater-than sign so raw HTML stays inert', () => {
    expect(parseLyricsMarkdown('a > b')).toBe('a &gt; b')
    expect(parseLyricsMarkdown('-->')).toBe('--&gt;')
  })

  it('parseLyricsMarkdown neutralises an injected script tag', () => {
    const html = parseLyricsMarkdown("<script>document.title = 'pwned'</script>")

    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('</script')
  })

  it('parseLyricsMarkdown neutralises an injected img tag with an inline event handler', () => {
    const html = parseLyricsMarkdown('<img src=x onerror=boom()>')

    expect(html).toContain('&lt;img src=x onerror=boom()&gt;')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('>')
  })

  it('parseLyricsMarkdown wraps a double-asterisk run in strong', () => {
    expect(parseLyricsMarkdown('**Chorus**')).toBe('<strong>Chorus</strong>')
  })

  it('parseLyricsMarkdown wraps a single-asterisk run in em', () => {
    expect(parseLyricsMarkdown('*softly*')).toBe('<em>softly</em>')
  })

  it('parseLyricsMarkdown wraps a double-underscore run in u', () => {
    expect(parseLyricsMarkdown('__hold__')).toBe('<u>hold</u>')
  })

  it('parseLyricsMarkdown renders a bracketed chord as the emerald badge', () => {
    expect(parseLyricsMarkdown('[Am]')).toBe(`<strong class="${CHORD_CLASS}">Am</strong>`)
  })

  it('parseLyricsMarkdown spans a line break inside a bold run', () => {
    expect(parseLyricsMarkdown('**first\nsecond**')).toBe('<strong>first\nsecond</strong>')
  })

  it('parseLyricsMarkdown returns an empty string for empty input', () => {
    expect(parseLyricsMarkdown('')).toBe('')
  })
})
