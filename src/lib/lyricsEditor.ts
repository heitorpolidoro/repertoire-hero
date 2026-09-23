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

/** Which of the two lyrics texts a band entry is reading or writing. */
export type LyricsVersion = 'band' | 'personal'

/** True when a string holds something other than whitespace. */
function isNonEmpty(text: string | null | undefined): boolean {
  return !!text && text.trim().length > 0
}

/**
 * Which version is read with no interaction at all: the member's own whenever
 * it holds text, the band's otherwise — the "personal wins" rule the tab
 * library already applies. Outside a band there is only one version, so it is
 * always `'band'` (RH-83 ER1).
 */
export function resolveLyricsVersion(
  entry: LyricsSource | null,
  personalEntry: LyricsSource | null,
): LyricsVersion {
  return entry?.band_id && isNonEmpty(personalEntry?.lyrics) ? 'personal' : 'band'
}

/**
 * True when a band entry's member has a non-empty version of their own —
 * differing from the band's or not. Seeing the band's text is how they decide
 * whether to keep theirs, so the switcher is offered either way (RH-83).
 */
export function hasPersonalVersion(
  entry: LyricsSource | null,
  personalEntry: LyricsSource | null,
): boolean {
  return !!entry?.band_id && isNonEmpty(personalEntry?.lyrics)
}

/** Which lyrics text is on screen: the personal one only in a band, only on that version, only when loaded. */
export function selectDisplayedLyrics(
  entry: LyricsSource | null,
  personalEntry: LyricsSource | null,
  version: LyricsVersion,
): string | null {
  if (!entry) return null
  return (entry.band_id && version === 'personal' && personalEntry) ? personalEntry.lyrics : entry.lyrics
}

/**
 * The text a freshly opened editor starts from (RH-83 ER5).
 *
 * A first personal version is seeded with the band's text rather than empty:
 * the dominant use is "the band's chart with my cues", and clearing a seeded
 * draft is one select-all-delete while re-pasting it is not.
 */
export function seedLyricsDraft(
  version: LyricsVersion,
  entry: LyricsSource | null,
  personalEntry: LyricsSource | null,
): string {
  if (version === 'personal' && isNonEmpty(personalEntry?.lyrics)) return personalEntry?.lyrics ?? ''
  return entry?.lyrics ?? ''
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
  version: LyricsVersion
}): LyricsSaveTarget {
  if (args.entryBandId && args.version === 'personal') {
    return { repertoireId: args.personalRepertoireId, bandId: null, toPersonalEntry: true }
  }
  return { repertoireId: args.entryId, bandId: args.entryBandId, toPersonalEntry: false }
}

/** Everything `useLyricsEditor` exposes, declared here so the components never import `src/hooks`. */
export interface LyricsEditorController {
  /** `entry.band_id` is set: drives the Band/Personal badge. */
  isBandEntry: boolean
  displayedLyrics: string | null
  /** The version on screen: the badge and the switcher label both read it. */
  activeVersion: LyricsVersion
  /** A band member has a non-empty version of their own: the switcher banner. */
  hasPersonalVersion: boolean
  toggleVersion: () => void
  /** True while the band-or-personal choice dialog is open (band context only). */
  isVersionChoiceOpen: boolean
  /** `personalEntry?.id ?? null` — null is what the dialog discloses (ER15). */
  personalRepertoireId: string | null
  chooseVersion: (version: LyricsVersion) => void
  cancelVersionChoice: () => void
  /** Which version the open editor writes to; null while not editing. */
  editTarget: LyricsVersion | null
  isEditing: boolean
  draft: string
  setDraft: (text: string) => void
  startEditing: () => void
  cancelEditing: () => void
  saving: boolean
  save: () => Promise<void>
  /** Editing an existing personal version: the Discard my version control. */
  canDiscardPersonal: boolean
  isDiscardPending: boolean
  requestDiscard: () => void
  cancelDiscard: () => void
  confirmDiscard: () => Promise<void>
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
