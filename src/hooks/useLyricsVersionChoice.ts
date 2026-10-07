import { useCallback, useState } from 'react'
import {
  hasPersonalVersion as hasPersonalVersionFor,
  resolveLyricsVersion,
  selectDisplayedLyrics,
  type LyricsSource,
  type LyricsVersion,
} from '@/lib/lyricsEditor'

/**
 * The band-vs-personal half of Fast View's lyrics controller (RH-83).
 *
 * Split out of `useLyricsEditor` for the `useBandEdit`/`useBandAdmin` reason
 * and no other: the editor's own body (draft, save, auto-import, Stage Mode)
 * plus this state would sit against the 200-line `max-lines-per-function`
 * budget, and the budget list is a ratchet that may not gain an entry (F20).
 *
 * Three pieces of state, deliberately kept apart:
 *
 *   - `override` — the version the musician *chose to look at*, `null` while
 *     the resolution rule (`resolveLyricsVersion`, personal-wins) decides.
 *   - `editTarget` — the version the open editor *writes to*. Never conflated
 *     with the displayed one: editing the band's text while the personal
 *     version is on screen is a normal thing to do.
 *   - `discardPending` — the in-panel "Discard my version" confirmation, which
 *     is a `ConfirmPanel`, never a browser dialog.
 */
export interface LyricsVersionChoice {
  activeVersion: LyricsVersion
  displayedLyrics: string | null
  hasPersonalVersion: boolean
  isVersionChoiceOpen: boolean
  editTarget: LyricsVersion | null
  isDiscardPending: boolean
  /** Band context only: the Edit/Add button asks before opening the editor. */
  openChoice: () => void
  cancelVersionChoice: () => void
  /** A choice was made: close the dialog and aim the editor at that version. */
  startEditingVersion: (version: LyricsVersion) => void
  /** Editing ended without a write: the displayed version is untouched. */
  stopEditing: () => void
  /**
   * A write landed. `saved` becomes the displayed version (ER7); `null` clears
   * the override so the resolution rule decides again — which is how a discard
   * falls back to the band's text.
   */
  finishEditing: (saved: LyricsVersion | null) => void
  toggleVersion: () => void
  requestDiscard: () => void
  cancelDiscard: () => void
}

/**
 * Both arguments are `LyricsSource`, the two-field slice the pure helpers read.
 *
 * `personalEntry` is a `Repertoire` and fits structurally; the route entry is a
 * `ResolvedSongEntry` since RH-132 and carries no `band_id`, so
 * `useLyricsEditor` adapts it at its own boundary from the page's `?bandId=`
 * (§3b) rather than this hook growing a third parameter.
 */
export function useLyricsVersionChoice(
  entry: LyricsSource | null,
  personalEntry: LyricsSource | null,
): LyricsVersionChoice {
  const [override, setOverride] = useState<LyricsVersion | null>(null)
  const [editTarget, setEditTarget] = useState<LyricsVersion | null>(null)
  const [isVersionChoiceOpen, setIsVersionChoiceOpen] = useState(false)
  const [isDiscardPending, setIsDiscardPending] = useState(false)

  const activeVersion = override ?? resolveLyricsVersion(entry, personalEntry)

  const openChoice = useCallback(() => setIsVersionChoiceOpen(true), [])
  const cancelVersionChoice = useCallback(() => setIsVersionChoiceOpen(false), [])

  const startEditingVersion = useCallback((version: LyricsVersion) => {
    setIsVersionChoiceOpen(false)
    setIsDiscardPending(false)
    setEditTarget(version)
  }, [])

  const stopEditing = useCallback(() => {
    setEditTarget(null)
    setIsDiscardPending(false)
  }, [])

  const finishEditing = useCallback((saved: LyricsVersion | null) => {
    setEditTarget(null)
    setIsDiscardPending(false)
    setOverride(saved)
  }, [])

  const toggleVersion = useCallback(
    () => setOverride(activeVersion === 'personal' ? 'band' : 'personal'),
    [activeVersion],
  )

  const requestDiscard = useCallback(() => setIsDiscardPending(true), [])
  const cancelDiscard = useCallback(() => setIsDiscardPending(false), [])

  return {
    activeVersion,
    displayedLyrics: selectDisplayedLyrics(entry, personalEntry, activeVersion),
    hasPersonalVersion: hasPersonalVersionFor(entry, personalEntry),
    isVersionChoiceOpen,
    editTarget,
    isDiscardPending,
    openChoice,
    cancelVersionChoice,
    startEditingVersion,
    stopEditing,
    finishEditing,
    toggleVersion,
    requestDiscard,
    cancelDiscard,
  }
}
