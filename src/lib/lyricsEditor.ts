/**
 * Pure, DOM-free decision helpers for Fast View's lyrics editor (RH-51).
 *
 * Extracted for the same reason as `tabLibrary.ts` (RH-49): the decisions that
 * are easy to get wrong — which repertoire a lyrics save is issued against,
 * which of the two versions (band or personal) is on screen, and where the
 * Stage Mode font size stops — become directly unit-testable in the default
 * `node` vitest environment, with no DOM, no React and no Server Action.
 *
 * This module must not import the App Router tree, and nothing here reads the
 * page's `entry` beyond the two fields `LyricsSource` names.
 *
 * It also declares the `LyricsEditorController` contract, so the presentational
 * components under `src/components/fastview` can type the controller they
 * receive without importing the hook that builds it.
 */

/** The slice of a repertoire row the lyrics helpers read. `Repertoire` fits structurally. */
export interface LyricsSource {
  band_id: string | null
  lyrics: string | null
}

export const LYRICS_FONT_MIN = 12
export const LYRICS_FONT_MAX = 36
export const LYRICS_FONT_DEFAULT = 18
export const LYRICS_FONT_STEP = 2

/** Clamps a Stage Mode font size into [LYRICS_FONT_MIN, LYRICS_FONT_MAX]. */
export function clampLyricsFontSize(size: number): number {
  return Math.min(LYRICS_FONT_MAX, Math.max(LYRICS_FONT_MIN, size))
}

/** `current + delta`, clamped. The A- / A+ buttons pass -/+ LYRICS_FONT_STEP. */
export function stepLyricsFontSize(current: number, delta: number): number {
  return clampLyricsFontSize(current + delta)
}

/** True when a band entry's member has their own, non-empty, different lyrics. */
export function hasDifferentPersonalLyrics(
  entry: LyricsSource | null,
  personalEntry: LyricsSource | null,
): boolean {
  return !!(entry?.band_id && personalEntry && personalEntry.lyrics && personalEntry.lyrics !== entry.lyrics)
}

/** Which lyrics text is on screen: the personal version only in a band, only when selected, only when loaded. */
export function selectDisplayedLyrics(
  entry: LyricsSource | null,
  personalEntry: LyricsSource | null,
  showPersonalLyrics: boolean,
): string | null {
  if (!entry) return null
  return (entry.band_id && showPersonalLyrics && personalEntry) ? personalEntry.lyrics : entry.lyrics
}

/** Where a lyrics save is issued. A null `repertoireId` means "create the personal entry first". */
export interface LyricsSaveTarget {
  repertoireId: string | null
  /** The `bandId` argument of `updateLyrics`; null for a personal row. */
  bandId: string | null
  /** True when the saved text belongs to the page's `personalEntry` state rather than `entry`. */
  toPersonalEntry: boolean
}

export function resolveLyricsSaveTarget(args: {
  entryId: string
  entryBandId: string | null
  personalRepertoireId: string | null
  showPersonalLyrics: boolean
}): LyricsSaveTarget {
  if (args.entryBandId && args.showPersonalLyrics) {
    return { repertoireId: args.personalRepertoireId, bandId: null, toPersonalEntry: true }
  }
  return { repertoireId: args.entryId, bandId: args.entryBandId, toPersonalEntry: false }
}

/** Everything `useLyricsEditor` exposes, declared here so the components never import `src/hooks`. */
export interface LyricsEditorController {
  /** `entry.band_id` is set: drives the Band/Personal badge. */
  isBandEntry: boolean
  displayedLyrics: string | null
  hasDifferentPersonalLyrics: boolean
  showPersonalLyrics: boolean
  toggleVersion: () => void
  isEditing: boolean
  draft: string
  setDraft: (text: string) => void
  startEditing: () => void
  cancelEditing: () => void
  saving: boolean
  save: () => Promise<void>
  fetching: boolean
  autoImport: () => Promise<void>
  isStageOpen: boolean
  openStage: () => void
  closeStage: () => void
  fontSize: number
  increaseFont: () => void
  decreaseFont: () => void
  isDarkMode: boolean
  toggleDarkMode: () => void
}
