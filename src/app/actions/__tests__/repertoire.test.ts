/**
 * RH-45 — the repertoire actions no longer carry SQL: `updateLyrics`,
 * `applySongLinkUpdate` and `getPersonalEntryForSong` moved into `@/lib/songs`,
 * which this suite already mocked for the other nine actions. What is asserted
 * here is delegation: the owner fork, the resolved `songId`, and which branches
 * call `revalidatePath`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  assertRepertoireAccess: vi.fn(),
  updateLyrics: vi.fn(),
  applySongLinkUpdate: vi.fn(),
  getPersonalEntryForSong: vi.fn(),
}))

vi.mock('@/lib/bands', () => ({
  assertBandMember: vi.fn(),
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
  assertRepertoireAccess,
  updateLyrics,
  applySongLinkUpdate,
  getPersonalEntryForSong,
} from '@/lib/songs'
import { assertBandMember } from '@/lib/bands'
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
  vi.mocked(revalidatePath).mockReset()
  vi.mocked(fetchUrlTitle).mockReset()
  vi.mocked(getRequiredUserId).mockReset()
  vi.mocked(getRequiredUserId).mockResolvedValue(USER_ID)
  vi.mocked(assertBandMember).mockReset()
  vi.mocked(assertBandMember).mockResolvedValue('member')
  vi.mocked(assertRepertoireAccess).mockReset()
  vi.mocked(assertRepertoireAccess).mockResolvedValue({
    id: REPERTOIRE_ID,
    song_id: SONG_ID,
    user_id: USER_ID,
    band_id: null,
  })
  vi.mocked(updateLyrics).mockReset()
  vi.mocked(applySongLinkUpdate).mockReset()
  vi.mocked(getPersonalEntryForSong).mockReset()
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

      // The session is resolved on every call, band-owned or not, and the band
      // context is authorized against the caller exactly once (the band case).
      expect(vi.mocked(getRequiredUserId)).toHaveBeenCalledTimes(3)
      expect(assertBandMember).toHaveBeenCalledExactlyOnceWith(BAND_ID, USER_ID)
      expect(vi.mocked(revalidatePath).mock.calls.length > 0).toBe(revalidates)
      if (revalidates) expect(revalidatePath).toHaveBeenCalledWith('/')
    },
  )

  it.each(DELEGATIONS)('$label refuses a bandId the caller is not a member of', async ({ lib, run }) => {
    vi.mocked(assertBandMember).mockRejectedValue(new Error('Access denied: not a member of this band'))

    await expect(run(BAND_ID)).rejects.toThrow('Access denied')
    expect(lib()).not.toHaveBeenCalled()
  })

  it('resolves a session for the ownerless catalog actions too', async () => {
    vi.mocked(searchGlobalSongs).mockResolvedValue(['hit'] as never)
    vi.mocked(fetchUrlTitle).mockResolvedValue('Some Title')

    await expect(searchGlobalSongsAction('nirvana')).resolves.toEqual(['hit'])
    expect(searchGlobalSongs).toHaveBeenCalledWith('nirvana')

    await expect(fetchUrlTitleAction('https://example.com')).resolves.toBe('Some Title')
    expect(fetchUrlTitle).toHaveBeenCalledWith('https://example.com')

    expect(getRequiredUserId).toHaveBeenCalledTimes(2)
  })
})

describe('updateLyricsAction', () => {
  it.each([
    ['band', BAND_ID, { bandId: BAND_ID }],
    ['personal', undefined, { userId: USER_ID }],
    ['personal (explicit null bandId)', null, { userId: USER_ID }],
  ])('forwards the resolved %s owner to updateLyrics', async (_label, bandId, owner) => {
    await updateLyricsAction(REPERTOIRE_ID, 'la la la', bandId)

    expect(updateLyrics).toHaveBeenCalledExactlyOnceWith(owner, REPERTOIRE_ID, 'la la la')
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('refuses a bandId the caller is not a member of, without writing', async () => {
    vi.mocked(assertBandMember).mockRejectedValueOnce(new Error('Access denied: not a member of this band'))

    await expect(updateLyricsAction(REPERTOIRE_ID, 'hijacked', BAND_ID)).rejects.toThrow('Access denied')
    expect(updateLyrics).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
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
  const EXISTING: SongLink = { label: 'Chords', url: 'https://tabs.example/1' }
  const ADDED: SongLink = { label: 'Video', url: 'https://youtu.be/abc' }

  it('resolves the song id through assertRepertoireAccess and forwards it', async () => {
    vi.mocked(applySongLinkUpdate).mockResolvedValue({ success: true })

    await expect(updateSongLinksAction(REPERTOIRE_ID, [EXISTING, ADDED])).resolves.toEqual({
      success: true,
    })

    expect(assertRepertoireAccess).toHaveBeenCalledWith(REPERTOIRE_ID, USER_ID)
    expect(applySongLinkUpdate).toHaveBeenCalledExactlyOnceWith(USER_ID, SONG_ID, [EXISTING, ADDED])
    // An additive write is visible immediately, so the page is revalidated.
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('does not revalidate when the edit went to the moderation queue instead', async () => {
    vi.mocked(applySongLinkUpdate).mockResolvedValue({ success: true, pending: true })

    await expect(updateSongLinksAction(REPERTOIRE_ID, [])).resolves.toEqual({
      success: true,
      pending: true,
    })

    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('refuses a repertoire entry the caller may not act on, before any write', async () => {
    vi.mocked(assertRepertoireAccess).mockRejectedValueOnce(
      new Error('Access denied: not allowed on this repertoire entry'),
    )

    await expect(updateSongLinksAction(REPERTOIRE_ID, [EXISTING])).rejects.toThrow('Access denied')
    expect(applySongLinkUpdate).not.toHaveBeenCalled()
  })

  it('lets the lib-level Song entry not found propagate, without revalidating', async () => {
    vi.mocked(applySongLinkUpdate).mockRejectedValue(new Error('Song entry not found'))

    await expect(updateSongLinksAction(REPERTOIRE_ID, [EXISTING])).rejects.toThrow(
      'Song entry not found',
    )
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('getPersonalEntryForSongAction', () => {
  it('returns the row the lib function reports for the resolved user', async () => {
    vi.mocked(getPersonalEntryForSong).mockResolvedValue(ENTRY)

    await expect(getPersonalEntryForSongAction(SONG_ID)).resolves.toEqual(ENTRY)

    expect(getPersonalEntryForSong).toHaveBeenCalledExactlyOnceWith(SONG_ID, USER_ID)
  })

  it('returns null when the user has no personal entry for the song', async () => {
    vi.mocked(getPersonalEntryForSong).mockResolvedValue(null)

    await expect(getPersonalEntryForSongAction(SONG_ID)).resolves.toBeNull()
  })

  it('swallows a missing session and returns null rather than propagating', async () => {
    vi.mocked(getRequiredUserId).mockRejectedValueOnce(new Error('No session'))

    await expect(getPersonalEntryForSongAction(SONG_ID)).resolves.toBeNull()
    expect(getPersonalEntryForSong).not.toHaveBeenCalled()
  })

  it('swallows an L1-wrapped read failure too', async () => {
    vi.mocked(getPersonalEntryForSong).mockRejectedValue(
      new Error('Failed to fetch personal entry for song: connection lost'),
    )

    await expect(getPersonalEntryForSongAction(SONG_ID)).resolves.toBeNull()
  })
})
