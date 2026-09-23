import { useCallback, useState } from 'react'
import {
  resolveLyricsSaveTarget,
  seedLyricsDraft,
  type LyricsEditorController,
  type LyricsVersion,
} from '@/lib/lyricsEditor'
import { useLyricsStage } from '@/hooks/useLyricsStage'
import { useLyricsVersionChoice } from '@/hooks/useLyricsVersionChoice'
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
  /**
   * Creates the member's own entry the first time they save personal lyrics.
   * `seedStatusFromBandId` is the band whose current status for the song the
   * new row copies, so writing a lyric note cannot drag the band's mastery to
   * Unknown (RH-83 ER16). Never "the owner of the new row" — that is always
   * the session's own user.
   */
  addSong: (songId: string, seedStatusFromBandId: string | null) => Promise<Repertoire>
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
 * the online auto-import, the band/personal choice dialog and version switch
 * and the discard of a personal version.
 *
 * Two siblings hold the rest of the controller it returns:
 * `useLyricsVersionChoice` (which version is read, which one is being written)
 * and `useLyricsStage` (the full-screen reading surface). Both were split out
 * in RH-83 for the `max-lines-per-function` reason documented in each.
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
  const stage = useLyricsStage()
  const choice = useLyricsVersionChoice(entry, personalEntry)
  const displayed = choice.displayedLyrics

  const chooseVersion = useCallback(
    (version: LyricsVersion) => {
      setDraft(seedLyricsDraft(version, entry, personalEntry))
      choice.startEditingVersion(version)
      setIsEditing(true)
    },
    [choice, entry, personalEntry],
  )

  // Band context always asks, including once a personal version exists: the
  // operator chose consistency over fewer taps (RH-83 ER4).
  const startEditing = useCallback(() => {
    if (!entry) return
    if (entry.band_id) choice.openChoice()
    else chooseVersion('band')
  }, [choice, chooseVersion, entry])

  const cancelEditing = useCallback(() => {
    setDraft(displayed ?? '')
    setIsEditing(false)
    choice.stopEditing()
  }, [choice, displayed])

  const save = useCallback(async () => {
    if (!entry) return
    try {
      setSaving(true)
      const version = choice.editTarget ?? choice.activeVersion
      const target = resolveLyricsSaveTarget({
        entryId: entry.id,
        entryBandId: entry.band_id,
        personalRepertoireId: personalEntry?.id ?? null,
        version,
      })
      // A whitespace-only personal draft is the same act as Discard my version:
      // an empty personal `lyrics` is exactly "no personal version" (ER8).
      const text = target.toPersonalEntry && !draft.trim() ? '' : draft
      let repertoireId = target.repertoireId
      if (repertoireId === null) {
        const created = await actions.addSong(entry.song_id, entry.band_id)
        onPersonalEntryCreated(created)
        repertoireId = created.id
      }
      await actions.updateLyrics(repertoireId, text, target.bandId)
      if (target.toPersonalEntry) onPersonalLyricsSaved(text)
      else onEntryLyricsSaved(text)
      setIsEditing(false)
      choice.finishEditing(target.toPersonalEntry && text === '' ? null : version)
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
    choice,
    draft,
    entry,
    notify,
    onEntryLyricsSaved,
    onPersonalEntryCreated,
    onPersonalLyricsSaved,
    personalEntry,
  ])

  /**
   * Discarding writes an empty personal `lyrics`, which the resolution rule
   * reads as "no personal version". The row itself is never deleted — it also
   * carries the member's status, tags and tabs for this song (ER8).
   */
  const confirmDiscard = useCallback(async () => {
    if (!personalEntry) return
    try {
      setSaving(true)
      await actions.updateLyrics(personalEntry.id, '', null)
      onPersonalLyricsSaved('')
      setDraft('')
      setIsEditing(false)
      choice.finishEditing(null)
      notify('Your personal lyrics version was discarded.', 'success')
    } catch {
      notify('Failed to discard your lyrics version', 'error')
    } finally {
      setSaving(false)
    }
  }, [actions, choice, notify, onPersonalLyricsSaved, personalEntry])

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

  return {
    isBandEntry: !!entry?.band_id,
    displayedLyrics: displayed,
    activeVersion: choice.activeVersion,
    hasPersonalVersion: choice.hasPersonalVersion,
    toggleVersion: choice.toggleVersion,
    isVersionChoiceOpen: choice.isVersionChoiceOpen,
    personalRepertoireId: personalEntry?.id ?? null,
    chooseVersion,
    cancelVersionChoice: choice.cancelVersionChoice,
    editTarget: choice.editTarget,
    isEditing,
    draft,
    setDraft,
    startEditing,
    cancelEditing,
    saving,
    save,
    canDiscardPersonal: choice.editTarget === 'personal' && choice.hasPersonalVersion,
    isDiscardPending: choice.isDiscardPending,
    requestDiscard: choice.requestDiscard,
    cancelDiscard: choice.cancelDiscard,
    confirmDiscard,
    fetching,
    autoImport,
    ...stage,
  }
}
