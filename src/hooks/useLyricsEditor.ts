import { useCallback, useEffect, useState } from 'react'
import { isStageHistoryEntry, stageHistoryState } from '@/lib/stageHistory'
import {
  LYRICS_FONT_DEFAULT,
  LYRICS_FONT_STEP,
  hasDifferentPersonalLyrics as hasDifferentPersonalLyricsFor,
  resolveLyricsSaveTarget,
  selectDisplayedLyrics,
  stepLyricsFontSize,
  type LyricsEditorController,
} from '@/lib/lyricsEditor'
import type { ToastTone } from '@/lib/uiTones'
import type { Repertoire } from '@/types/database'

/**
 * The lyrics Server Actions the controller calls. Injected rather than imported,
 * so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted — a default would have to import that tree.
 */
export interface LyricsEditorActions {
  updateLyrics: (repertoireId: string, lyrics: string, bandId: string | null) => Promise<void>
  fetchLyrics: (artist: string, title: string) => Promise<string | null>
  /** Creates the member's own entry the first time they save personal lyrics. */
  addSong: (songId: string) => Promise<Repertoire>
}

export interface UseLyricsEditorOptions {
  /** The route's entry; null until it loads. Owned by the page (RH-52). */
  entry: Repertoire | null
  /** The member's own entry in band context, else null. Owned by the page (RH-52). */
  personalEntry: Repertoire | null
  /** `entry.song?.title ?? '(untitled)'` — the auto-import query and its toast. */
  songTitle: string
  /** `entry.song?.artist ?? ''` — the auto-import query and its toast. */
  artist: string
  /** Required, never defaulted — see `src/app/fastViewLyricsActions.ts` (F21). */
  actions: LyricsEditorActions
  onEntryLyricsSaved: (lyrics: string) => void
  onPersonalLyricsSaved: (lyrics: string) => void
  onPersonalEntryCreated: (entry: Repertoire) => void
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
}

/**
 * Fast View's lyrics controller: it owns the edit state and its draft, the save
 * (band or personal, creating the member's own entry when there is none yet),
 * the online auto-import, the band/personal version switch and the lyrics Stage
 * Mode — its open state, its font size, its dark mode and the back-button
 * intercept that closes it.
 *
 * All the decisions themselves live in `@/lib/lyricsEditor` and are unit-tested
 * without React; what is left here is the state, the effect and the wiring to
 * the injected actions and the page's two entry setters (RH-51).
 */
export function useLyricsEditor({
  entry,
  personalEntry,
  songTitle,
  artist,
  actions,
  onEntryLyricsSaved,
  onPersonalLyricsSaved,
  onPersonalEntryCreated,
  notify,
}: UseLyricsEditorOptions): LyricsEditorController {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [showPersonalLyrics, setShowPersonalLyrics] = useState(false)
  const [isStageOpen, setIsStageOpen] = useState(false)
  const [fontSize, setFontSize] = useState(LYRICS_FONT_DEFAULT)
  const [isDarkMode, setIsDarkMode] = useState(false)

  const displayed = selectDisplayedLyrics(entry, personalEntry, showPersonalLyrics)

  const startEditing = useCallback(() => {
    setDraft(displayed ?? '')
    setIsEditing(true)
  }, [displayed])

  const cancelEditing = useCallback(() => {
    setDraft(displayed ?? '')
    setIsEditing(false)
  }, [displayed])

  const toggleVersion = useCallback(() => setShowPersonalLyrics((prev) => !prev), [])

  const save = useCallback(async () => {
    if (!entry) return
    try {
      setSaving(true)
      const target = resolveLyricsSaveTarget({
        entryId: entry.id,
        entryBandId: entry.band_id,
        personalRepertoireId: personalEntry?.id ?? null,
        showPersonalLyrics,
      })
      let repertoireId = target.repertoireId
      if (repertoireId === null) {
        const created = await actions.addSong(entry.song_id)
        onPersonalEntryCreated(created)
        repertoireId = created.id
      }
      await actions.updateLyrics(repertoireId, draft, target.bandId)
      if (target.toPersonalEntry) onPersonalLyricsSaved(draft)
      else onEntryLyricsSaved(draft)
      setIsEditing(false)
      notify('Lyrics saved successfully!', 'success')
    } catch {
      // The reason never reaches the user beyond this Toast; the editor stays
      // open with the draft intact, so a retry is one more click.
      notify('Failed to save lyrics', 'error')
    } finally {
      setSaving(false)
    }
  }, [
    actions,
    draft,
    entry,
    notify,
    onEntryLyricsSaved,
    onPersonalEntryCreated,
    onPersonalLyricsSaved,
    personalEntry,
    showPersonalLyrics,
  ])

  const autoImport = useCallback(async () => {
    if (!artist) {
      notify('Artist name is required to search for lyrics.', 'warning')
      return
    }
    try {
      setFetching(true)
      const lyrics = await actions.fetchLyrics(artist, songTitle)
      if (lyrics) {
        setDraft(lyrics)
        notify('Lyrics imported online!', 'success')
      } else {
        notify(`Lyrics not found online for "${songTitle}" by "${artist}". You can still paste them below.`, 'warning')
      }
    } catch {
      // Same swallow as the save: the import is best-effort and the musician can
      // always paste the lyrics by hand.
      notify('Failed to import lyrics from web. You can still paste them below.', 'error')
    } finally {
      setFetching(false)
    }
  }, [actions, artist, notify, songTitle])

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
    isBandEntry: !!entry?.band_id,
    displayedLyrics: displayed,
    hasDifferentPersonalLyrics: hasDifferentPersonalLyricsFor(entry, personalEntry),
    showPersonalLyrics,
    toggleVersion,
    isEditing,
    draft,
    setDraft,
    startEditing,
    cancelEditing,
    saving,
    save,
    fetching,
    autoImport,
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
