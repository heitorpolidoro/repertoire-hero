// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useSongWindow } from '@/hooks/useSongWindow'
import { useSongEntry } from '@/hooks/useSongEntry'
import { useSongCustomFields } from '@/hooks/useSongCustomFields'
import { writeSongQueue } from '@/lib/songQueue'
import { cachedSong, resetSongWindow, type SongWindowRecord } from '@/lib/songWindow'
import type { ResolvedSongEntry } from '@/types/database'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

afterEach(cleanup)

beforeEach(() => {
  resetSongWindow()
  window.sessionStorage.clear()
  writeSongQueue({
    entries: ['v1', 'v2', 'v3', 'v4', 'v5'].map((versionId) => ({ versionId, title: versionId, artist: null })),
    owner: { type: 'personal' },
    originHref: '/',
    label: 'Set',
  })
})

function entryOf(versionId: string, lyrics: string): ResolvedSongEntry {
  return { ownerRowId: 'row', song_id: `song-${versionId}`, version_id: versionId, lyrics } as unknown as ResolvedSongEntry
}

describe('write invalidates the window', () => {
  it('edit song 4 lyrics, go to 3 and back shows the new text', async () => {
    // The "server": song 4's lyrics change when the write lands.
    const server = { v4: 'old words' }
    const getSongWindow = vi.fn(async (ids: string[]): Promise<SongWindowRecord[]> =>
      ids.map((id) => ({
        versionId: id,
        entry: entryOf(id, id === 'v4' ? server.v4 : `lyrics ${id}`),
        files: [],
        customFields: [],
      })),
    )
    const getResolvedEntryForVersion = vi.fn(async (id: string) =>
      entryOf(id, id === 'v4' ? server.v4 : `lyrics ${id}`),
    )

    const { result, rerender } = renderHook(
      ({ versionId }: { versionId: string }) => {
        const window = useSongWindow({ versionId, bandId: null, actions: { getSongWindow } })
        const song = useSongEntry({
          versionId,
          bandId: null,
          actions: { getResolvedEntryForVersion, getPersonalEntryForSong: vi.fn() },
        })
        return { window, song }
      },
      { initialProps: { versionId: 'v3' } },
    )

    // Arrived at 3: song 4 is prefetched with the old words.
    await waitFor(() => expect(result.current.song.entry?.lyrics).toBe('lyrics v3'))
    expect(getSongWindow).toHaveBeenCalledWith(['v2', 'v3', 'v4'], null)

    // Go to 4 (served from the prefetch), edit its lyrics, and write.
    rerender({ versionId: 'v4' })
    await waitFor(() => expect(result.current.song.entry?.lyrics).toBe('old words'))
    expect(getResolvedEntryForVersion).not.toHaveBeenCalledWith('v4', null)
    server.v4 = 'new words'
    act(() => result.current.window.afterWrite(result.current.song.applyEntryLyrics)('new words'))

    // Go to 3 and back to 4: the new text, not the prefetched copy.
    rerender({ versionId: 'v3' })
    await waitFor(() => expect(result.current.song.entry?.lyrics).toBe('lyrics v3'))
    rerender({ versionId: 'v4' })
    await waitFor(() => expect(result.current.song.entry?.lyrics).toBe('new words'))
  })

  describe('custom fields (RH-190)', () => {
    /**
     * The page's wiring: the hook after `useSongWindow`, its on-saved being the
     * page's `invalidateCurrent`. `server` holds the Preset of each version.
     */
    function setupFields(setCustomFieldValue: (fieldId: string, versionId: string, value: string) => Promise<string | null>) {
      const server: Record<string, string | null> = { v4: 'old preset' }
      const presetOf = (versionId: string) => [{ fieldId: 'f1', name: 'Preset', value: server[versionId] ?? null }]
      const getSongWindow = vi.fn(async (ids: string[]): Promise<SongWindowRecord[]> =>
        ids.map((id) => ({ versionId: id, entry: entryOf(id, id), files: [], customFields: presetOf(id) })),
      )
      const getCustomFieldValues = vi.fn(async (id: string) => presetOf(id))
      const actions = { getCustomFieldValues, setCustomFieldValue }
      const windowActions = { getSongWindow }
      const notify = vi.fn()
      const view = renderHook(
        ({ versionId }: { versionId: string }) => {
          const songWindow = useSongWindow({ versionId, bandId: null, actions: windowActions })
          return useSongCustomFields({ versionId, bandId: null, actions, notify, onSaved: songWindow.invalidateCurrent })
        },
        { initialProps: { versionId: 'v3' } },
      )
      return { ...view, server, getCustomFieldValues }
    }

    it('edit a custom field, go to a neighbour and back shows the new value', async () => {
      const { result, rerender, server, getCustomFieldValues } = setupFields(async (_field, versionId, value) => {
        server[versionId] = value
        return value
      })

      // Arrived at 3: song 4 is prefetched with the old value.
      await waitFor(() => expect(cachedSong(null, 'v4')).toBeDefined())
      rerender({ versionId: 'v4' })
      expect(result.current.entries[0].value).toBe('old preset')

      act(() => result.current.openEditor('f1'))
      act(() => result.current.setDraft('new preset'))
      await act(async () => { await result.current.submit() })
      expect(result.current.entries[0].value).toBe('new preset')
      expect(cachedSong(null, 'v4')).toBeUndefined()

      rerender({ versionId: 'v3' })
      await waitFor(() => expect(cachedSong(null, 'v4')).toBeDefined())
      rerender({ versionId: 'v4' })
      await waitFor(() => expect(result.current.entries[0].value).toBe('new preset'))
      expect(getCustomFieldValues).not.toHaveBeenCalled()
    })

    it('a failed save invalidates nothing', async () => {
      const { result, rerender } = setupFields(() => Promise.reject(new Error('down')))
      await waitFor(() => expect(cachedSong(null, 'v4')).toBeDefined())
      rerender({ versionId: 'v4' })

      act(() => result.current.openEditor('f1'))
      await act(async () => { await result.current.submit() })

      expect(cachedSong(null, 'v4')?.customFields[0].value).toBe('old preset')
    })

    it('a save answered after moving on invalidates the song it was made on, not the one on screen', async () => {
      let answer!: (value: string) => void
      const { result, rerender } = setupFields(() => new Promise((resolve) => (answer = resolve)))
      await waitFor(() => expect(cachedSong(null, 'v4')).toBeDefined())
      rerender({ versionId: 'v4' })

      act(() => result.current.openEditor('f1'))
      act(() => result.current.setDraft('new preset'))
      let saving!: Promise<void>
      act(() => { saving = result.current.submit() })
      rerender({ versionId: 'v3' })
      await act(async () => {
        answer('new preset')
        await saving
      })

      expect(cachedSong(null, 'v4')).toBeUndefined()
      expect(cachedSong(null, 'v3')).toBeDefined()
    })
  })
})
