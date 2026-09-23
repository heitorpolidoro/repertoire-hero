import { useCallback, useEffect, useState } from 'react'
import { isStageHistoryEntry, stageHistoryState } from '@/lib/stageHistory'
import { LYRICS_FONT_DEFAULT, LYRICS_FONT_STEP, stepLyricsFontSize } from '@/lib/lyricsEditor'

/** The lyrics Stage Mode slice of `LyricsEditorController`. */
export interface LyricsStageController {
  isStageOpen: boolean
  openStage: () => void
  closeStage: () => void
  fontSize: number
  increaseFont: () => void
  decreaseFont: () => void
  isDarkMode: boolean
  toggleDarkMode: () => void
}

/**
 * Lyrics Stage Mode: the full-screen reading surface's open state, its font
 * size, its dark mode and the back-button intercept that closes it (RH-51).
 *
 * A sibling of `useLyricsEditor` rather than part of it — the mirror of
 * `usePdfStage`, which already owns the PDF surface the same way. Split out in
 * RH-83, when the band-vs-personal choice pushed the editor's own body past the
 * 200-line `max-lines-per-function` budget; the override list is a ratchet and
 * may not gain an entry (F20), and a Stage Mode that shares no state with the
 * editor's draft is the seam that was already there.
 */
export function useLyricsStage(): LyricsStageController {
  const [isStageOpen, setIsStageOpen] = useState(false)
  const [fontSize, setFontSize] = useState(LYRICS_FONT_DEFAULT)
  const [isDarkMode, setIsDarkMode] = useState(false)

  const openStage = useCallback(() => setIsStageOpen(true), [])

  const closeStage = useCallback(() => {
    setIsStageOpen(false)
    if (isStageHistoryEntry(window.history.state)) {
      window.history.back()
    }
  }, [])

  // Mobile back button intercept for the lyrics Stage Mode. PDF Stage Mode owns
  // the mirror image of this effect inside `usePdfStage`; both push the same
  // marker, from `@/lib/stageHistory`.
  useEffect(() => {
    if (!isStageOpen) return

    window.history.pushState(stageHistoryState(), '')

    const handlePopState = () => setIsStageOpen(false)

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isStageOpen])

  const increaseFont = useCallback(
    () => setFontSize((prev) => stepLyricsFontSize(prev, LYRICS_FONT_STEP)),
    [],
  )

  const decreaseFont = useCallback(
    () => setFontSize((prev) => stepLyricsFontSize(prev, -LYRICS_FONT_STEP)),
    [],
  )

  const toggleDarkMode = useCallback(() => setIsDarkMode((prev) => !prev), [])

  return {
    isStageOpen,
    openStage,
    closeStage,
    fontSize,
    increaseFont,
    decreaseFont,
    isDarkMode,
    toggleDarkMode,
  }
}
