// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useSongWindow } from '@/hooks/useSongWindow'
import { useSongEntry } from '@/hooks/useSongEntry'
import { writeSongQueue } from '@/lib/songQueue'
import { resetSongWindow, type SongWindowRecord } from '@/lib/songWindow'
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
})
