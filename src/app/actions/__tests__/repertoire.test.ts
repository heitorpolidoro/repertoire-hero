import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  pool: { query: vi.fn() },
}))

vi.mock('@/lib/auth-session', () => ({
  getRequiredUserId: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/linkFetcher', () => ({
  fetchUrlTitle: vi.fn(),
}))

vi.mock('@/lib/songs', () => ({
  getRepertoire: vi.fn(),
  addSongToRepertoire: vi.fn(),
  updateSongStatus: vi.fn(),
  updateSongTags: vi.fn(),
  removeSongFromRepertoire: vi.fn(),
  searchGlobalSongs: vi.fn(),
  getSongEntry: vi.fn(),
  updateSong: vi.fn(),
  createAndAddSong: vi.fn(),
}))

import {
  getRepertoireAction,
  addSongAction,
  updateSongStatusAction,
  updateSongTagsAction,
  removeSongAction,
  searchGlobalSongsAction,
  getSongEntryAction,
  updateSongAction,
  createAndAddSongAction,
  updateLyricsAction,
  fetchLyricsAction,
  updateSongLinksAction,
  getPersonalEntryForSongAction,
  fetchUrlTitleAction,
} from '../repertoire'
import { query } from '@/lib/db'
import { getRequiredUserId } from '@/lib/auth-session'
import { revalidatePath } from 'next/cache'
import { fetchUrlTitle } from '@/lib/linkFetcher'
import {
  getRepertoire,
  addSongToRepertoire,
  updateSongStatus,
  updateSongTags,
  removeSongFromRepertoire,
  searchGlobalSongs,
  getSongEntry,
  updateSong,
  createAndAddSong,
} from '@/lib/songs'
import type { Repertoire, SongLink } from '@/types/database'

const USER_ID = 'user-1'
const BAND_ID = 'band-1'
const REPERTOIRE_ID = 'repertoire-1'
const SONG_ID = 'song-1'

const ENTRY = { id: REPERTOIRE_ID, song_id: SONG_ID } as unknown as Repertoire
const UPDATE_DATA = { title: 'New Title' }
const CREATE_DATA = { title: 'Fresh', artist: 'Someone' }

/** Every action that funnels through `resolveOwner` before delegating to `@/lib/songs`. */
const DELEGATIONS: Array<{
  label: string
  lib: () => ReturnType<typeof vi.fn>
  run: (bandId?: string | null) => Promise<unknown>
  tail: unknown[]
  revalidates: boolean
}> = [
  {
    label: 'getRepertoireAction',
    lib: () => vi.mocked(getRepertoire),
    run: (bandId) => getRepertoireAction(bandId),
    tail: [],
    revalidates: false,
  },
  {
    label: 'addSongAction',
    lib: () => vi.mocked(addSongToRepertoire),
    run: (bandId) => addSongAction(SONG_ID, bandId),
    tail: [SONG_ID],
    revalidates: true,
  },
  {
    label: 'updateSongStatusAction',
    lib: () => vi.mocked(updateSongStatus),
    run: (bandId) => updateSongStatusAction(REPERTOIRE_ID, 'learning', bandId),
    tail: [REPERTOIRE_ID, 'learning'],
    revalidates: true,
  },
  {
    label: 'updateSongTagsAction',
    lib: () => vi.mocked(updateSongTags),
    run: (bandId) => updateSongTagsAction(REPERTOIRE_ID, ['rock'], bandId),
    tail: [REPERTOIRE_ID, ['rock']],
    revalidates: true,
  },
  {
    label: 'removeSongAction',
    lib: () => vi.mocked(removeSongFromRepertoire),
    run: (bandId) => removeSongAction(REPERTOIRE_ID, bandId),
    tail: [REPERTOIRE_ID],
    revalidates: true,
  },
  {
    label: 'getSongEntryAction',
    lib: () => vi.mocked(getSongEntry),
    run: (bandId) => getSongEntryAction(REPERTOIRE_ID, bandId),
    tail: [REPERTOIRE_ID],
    revalidates: false,
  },
  {
    label: 'updateSongAction',
    lib: () => vi.mocked(updateSong),
    run: (bandId) => updateSongAction(ENTRY, UPDATE_DATA, bandId),
    tail: [ENTRY, UPDATE_DATA],
    revalidates: true,
  },
  {
    label: 'createAndAddSongAction',
    lib: () => vi.mocked(createAndAddSong),
    run: (bandId) => createAndAddSongAction(CREATE_DATA, bandId),
    tail: [CREATE_DATA],
    revalidates: true,
  },
]

beforeEach(() => {
  vi.mocked(query).mockReset()
  vi.mocked(revalidatePath).mockReset()
  vi.mocked(fetchUrlTitle).mockReset()
  vi.mocked(getRequiredUserId).mockReset()
  vi.mocked(getRequiredUserId).mockResolvedValue(USER_ID)
  for (const delegation of DELEGATIONS) delegation.lib().mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('owner resolution', () => {
  it.each(DELEGATIONS)(
    '$label forks on bandId: { bandId } when supplied, { userId } when absent or null',
    async ({ lib, run, tail, revalidates }) => {
      const delegate = lib()
      delegate.mockResolvedValue('result')

      await expect(run(BAND_ID)).resolves.toBe('result')
      expect(delegate).toHaveBeenLastCalledWith({ bandId: BAND_ID }, ...tail)

      await run(undefined)
      expect(delegate).toHaveBeenLastCalledWith({ userId: USER_ID }, ...tail)

      await run(null)
      expect(delegate).toHaveBeenLastCalledWith({ userId: USER_ID }, ...tail)

      // The session is resolved on every call, band-owned or not.
      expect(vi.mocked(getRequiredUserId)).toHaveBeenCalledTimes(3)
      expect(vi.mocked(revalidatePath).mock.calls.length > 0).toBe(revalidates)
      if (revalidates) expect(revalidatePath).toHaveBeenCalledWith('/')
    },
  )

  it('does not resolve a session for the ownerless catalog actions', async () => {
    vi.mocked(searchGlobalSongs).mockResolvedValue(['hit'] as never)
    vi.mocked(fetchUrlTitle).mockResolvedValue('Some Title')

    await expect(searchGlobalSongsAction('nirvana')).resolves.toEqual(['hit'])
    expect(searchGlobalSongs).toHaveBeenCalledWith('nirvana')

    await expect(fetchUrlTitleAction('https://example.com')).resolves.toBe('Some Title')
    expect(fetchUrlTitle).toHaveBeenCalledWith('https://example.com')

    expect(getRequiredUserId).not.toHaveBeenCalled()
  })
})

describe('updateLyricsAction', () => {
  it.each([
    ['band', BAND_ID, 'band_id = $3', BAND_ID],
    ['personal', undefined, 'user_id = $3', USER_ID],
  ])('scopes the UPDATE to the %s owner', async (_label, bandId, clause, ownerValue) => {
    await updateLyricsAction(REPERTOIRE_ID, 'la la la', bandId)

    const [sql, params] = vi.mocked(query).mock.calls[0]
    expect(sql).toContain('UPDATE repertoire SET lyrics = $1')
    expect(sql).toContain(clause)
    expect(params).toEqual(['la la la', REPERTOIRE_ID, ownerValue])
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })
})

describe('fetchLyricsAction', () => {
  const stubFetch = (impl: () => Promise<unknown>) => {
    const spy = vi.fn(impl)
    vi.stubGlobal('fetch', spy)
    return spy
  }

  it('returns the lyrics from a successful lyrics.ovh response', async () => {
    const spy = stubFetch(async () => ({ ok: true, json: async () => ({ lyrics: 'verse one' }) }))

    await expect(fetchLyricsAction('Nirvana', 'Lithium')).resolves.toBe('verse one')
    expect(spy.mock.calls[0][0]).toBe('https://api.lyrics.ovh/v1/Nirvana/Lithium')
  })

  it('returns null when the response body carries no lyrics field', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({}) }))

    await expect(fetchLyricsAction('Nirvana', 'Lithium')).resolves.toBeNull()
  })

  it('returns null on a non-ok response', async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({ lyrics: 'ignored' }) }))

    await expect(fetchLyricsAction('Nirvana', 'Lithium')).resolves.toBeNull()
  })

  it('returns null when the fetch itself throws (timeout / network)', async () => {
    stubFetch(async () => {
      throw new Error('The operation timed out')
    })

    await expect(fetchLyricsAction('Nirvana', 'Lithium')).resolves.toBeNull()
  })
})

describe('updateSongLinksAction', () => {
  const LABELLED: SongLink[] = [{ label: 'Chords', url: 'https://tabs.example/1' }]

  it('resolves the song id through the repertoire row first', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ song_id: SONG_ID }] } as never)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] } as never)

    await expect(updateSongLinksAction(REPERTOIRE_ID, LABELLED)).resolves.toEqual({ success: true })

    const [sql, params] = vi.mocked(query).mock.calls[1]
    expect(sql).toContain('UPDATE global_songs SET links = $1')
    expect(params).toEqual([JSON.stringify(LABELLED), SONG_ID])
    expect(fetchUrlTitle).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('falls back to global_songs when the id is not a repertoire entry', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: SONG_ID }] } as never)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] } as never)

    await expect(updateSongLinksAction(SONG_ID, LABELLED)).resolves.toEqual({ success: true })
    expect(vi.mocked(query).mock.calls[1][0]).toContain('SELECT id FROM global_songs')
    expect(vi.mocked(query).mock.calls[2][1]).toEqual([JSON.stringify(LABELLED), SONG_ID])
  })

  it('throws Song entry not found when neither lookup matches', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)

    await expect(updateSongLinksAction('nope', LABELLED)).rejects.toThrow('Song entry not found')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    ['a blank label', '', 'Fetched Title', 'Fetched Title'],
    ['a whitespace-only label', '   ', 'Fetched Title', 'Fetched Title'],
    ['a blank label the fetcher cannot resolve', '', '', 'https://youtu.be/abc'],
  ])('auto-labels %s through fetchUrlTitle', async (_label, label, fetched, expected) => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ song_id: SONG_ID }] } as never)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] } as never)
    vi.mocked(fetchUrlTitle).mockResolvedValue(fetched)

    await updateSongLinksAction(REPERTOIRE_ID, [{ label, url: 'https://youtu.be/abc' }])

    expect(fetchUrlTitle).toHaveBeenCalledWith('https://youtu.be/abc')
    expect(vi.mocked(query).mock.calls[1][1]?.[0]).toBe(
      JSON.stringify([{ label: expected, url: 'https://youtu.be/abc' }]),
    )
  })
})

describe('getPersonalEntryForSongAction', () => {
  it('returns the joined personal repertoire row', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [ENTRY] } as never)

    await expect(getPersonalEntryForSongAction(SONG_ID)).resolves.toEqual(ENTRY)

    const [sql, params] = vi.mocked(query).mock.calls[0]
    expect(sql).toContain('WHERE r.song_id = $1 AND r.user_id = $2')
    expect(params).toEqual([SONG_ID, USER_ID])
  })

  it('returns null when the user has no personal entry for the song', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)

    await expect(getPersonalEntryForSongAction(SONG_ID)).resolves.toBeNull()
  })

  it('swallows a rejection and returns null rather than propagating', async () => {
    vi.mocked(getRequiredUserId).mockRejectedValueOnce(new Error('No session'))

    await expect(getPersonalEntryForSongAction(SONG_ID)).resolves.toBeNull()
  })
})
