/**
 * Utility to sanitize song titles by removing remastering, anniversary, and edition noise
 * while preserving distinct musical versions like Live, Acoustic, Demo, Unplugged, Cover.
 */

export function sanitizeSongTitle(title: string): string {
  if (!title) return ''
  let cleaned = title.trim()

  // Remove parenthesized or bracketed edition/remaster noise unless it's a live/acoustic version
  cleaned = cleaned.replace(/\s*[\(\[]\s*[^()\[\]]*\b(?:remaster|remastered|re-master|re-mastered|deluxe|anniversary|expanded|edition)\b[^()\[\]]*[\)\]]/gi, (match) => {
    if (/\b(live|acoustic|unplugged|demo|cover|instrumental|orchestral)\b/i.test(match)) {
      return match
    }
    return ''
  })

  // Remove trailing dash-separated edition/remaster noise
  cleaned = cleaned.replace(/\s*-\s*.*?\b(?:remaster|remastered|re-master|re-mastered|deluxe|anniversary|expanded)\b.*$/gi, (match) => {
    if (/\b(live|acoustic|unplugged|demo|cover|instrumental|orchestral)\b/i.test(match)) {
      return match
    }
    return ''
  })

  // Clean up empty parens/brackets, trailing dashes, or double spaces
  cleaned = cleaned
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s*-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || title.trim()
}

/**
 * Checks if a song title represents a distinct performance/arrangement version
 * (e.g. Live, Acoustic, Demo, Unplugged, Cover) rather than just a studio remaster.
 */
export function isSpecialSongVersion(title: string): boolean {
  if (!title) return false
  return /\b(live|acoustic|unplugged|demo|orchestral|instrumental|cover|radio edit|extended mix)\b/i.test(title)
}
