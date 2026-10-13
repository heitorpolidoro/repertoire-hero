/**
 * RH-142 — a Spotify share short link is resolved when it is saved, so the row
 * `applySongLinkUpdate` writes carries the canonical track url and the derived
 * `provider = 'spotify'`, and the push reads it like any other Spotify link.
 *
 * `fetch` is stubbed (the network is never touched); `withTransaction` is
 * wrapped only to observe whether a request is ever made while it is open.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestUser, deleteTestUser } from './test-helpers'

vi.mock('@/lib/linkFetcher', () => ({ fetchUrlTitle: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const tx = vi.hoisted(() => ({ open: false }))
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...actual,
    withTransaction: <T>(fn: Parameters<typeof actual.withTransaction<T>>[0]) =>
      actual.withTransaction<T>(async (client) => {
        tx.open = true
        try {
          return await fn(client)
        } finally {
          tx.open = false
        }
      }),
  }
})

import { query } from '@/lib/db'
import { logger } from '@/lib/logger'
import { fetchUrlTitle } from '@/lib/linkFetcher'
import { createAndAddSong } from '../ownerSongs'
import { applySongLinkUpdate } from '../songs'
import { spotifyLinkUrlsJson } from '../songLinksSql'
import { spotifyPushUris } from '../spotifyTrackUri'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const TRACK_ID = 'rh142shortlinktrk'
const CANONICAL = `https://open.spotify.com/track/${TRACK_ID}`
const SHORT = 'https://spotify.link/rh142abc'

describe.skipIf(!RUN_DB_TESTS)('short link resolution at write time (real database)', () => {
  const suffix = Date.now()
  let userId: string
  const createdSongIds: string[] = []
  let fetchMock: ReturnType<typeof vi.fn>
  let fetchedInsideTransaction: boolean

  const newSong = async (label: string): Promise<string> => {
    const entry = await createAndAddSong(
      { userId },
      { title: `RH-142 ${label} ${suffix} ${createdSongIds.length}`, artist: `RH-142 Artist ${suffix}` },
    )
    createdSongIds.push(entry.song_id)
    return entry.song_id
  }

  const storedLinks = async (songId: string) =>
    (
      await query<{ url: string; label: string; provider: string }>(
        'SELECT url, label, provider FROM song_links WHERE song_id = $1 ORDER BY position',
        [songId],
      )
    ).rows

  const pendingCount = async (songId: string): Promise<number> =>
    (
      await query(
        `SELECT 1 FROM catalog_suggestions c JOIN song_links sl ON sl.id = c.target_id
          WHERE c.target_table = 'song_links' AND sl.song_id = $1`,
        [songId],
      )
    ).rowCount ?? 0

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh142-${suffix}@example.com` })
  })

  beforeEach(() => {
    fetchedInsideTransaction = false
    fetchMock = vi.fn((url: string) => {
      if (tx.open) fetchedInsideTransaction = true
      const location = url.startsWith('https://spotify.link/') ? `${CANONICAL}?si=share` : ''
      return Promise.resolve(new Response(null, location ? { status: 302, headers: { location } } : { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(logger.warn).mockClear()
    vi.mocked(fetchUrlTitle).mockReset().mockResolvedValue('')
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    if (createdSongIds.length > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1)', [createdSongIds])
    }
    if (userId) await deleteTestUser(userId)
  })

  it.each(['https://spotify.link/rh142abc', 'https://spoti.fi/rh142abc'])(
    'stores %s as the canonical track url with provider spotify',
    async (shortUrl) => {
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(new Response(null, { status: 302, headers: { location: `${CANONICAL}?si=x` } })),
      )
      const songId = await newSong('Canonical')

      await expect(
        applySongLinkUpdate(userId, songId, [{ label: 'Share', url: shortUrl }]),
      ).resolves.toEqual({ success: true })

      expect(await storedLinks(songId)).toEqual([
        { url: CANONICAL, label: 'Share', provider: 'spotify' },
      ])
    },
  )

  it('resolves before the transaction opens and fetches the label title from the canonical url', async () => {
    vi.mocked(fetchUrlTitle).mockResolvedValue('Some Track')
    const songId = await newSong('PreTx')

    await applySongLinkUpdate(userId, songId, [{ label: '', url: SHORT }])

    expect(fetchMock).toHaveBeenCalled()
    expect(fetchedInsideTransaction).toBe(false)
    expect(fetchUrlTitle).toHaveBeenCalledWith(CANONICAL)
    expect(await storedLinks(songId)).toEqual([
      { url: CANONICAL, label: 'Some Track', provider: 'spotify' },
    ])
  })

  it('stores the link exactly as typed, logs, and succeeds when resolution fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const songId = await newSong('Failing')

    await expect(
      applySongLinkUpdate(userId, songId, [{ label: 'Share', url: SHORT }]),
    ).resolves.toEqual({ success: true })

    expect(await storedLinks(songId)).toEqual([{ url: SHORT, label: 'Share', provider: 'other' }])
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('does not treat an unchanged stored short link as a removal', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const songId = await newSong('Unchanged')
    await applySongLinkUpdate(userId, songId, [{ label: 'Share', url: SHORT }])
    fetchMock.mockClear()
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: CANONICAL } })),
    )

    const result = await applySongLinkUpdate(userId, songId, [{ label: 'Share', url: SHORT }])

    expect(result).toEqual({ success: true })
    expect(await pendingCount(songId)).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await storedLinks(songId)).toEqual([{ url: SHORT, label: 'Share', provider: 'other' }])
  })

  it('contributes the spotify:track uri of a song saved from a short link to the push', async () => {
    const songId = await newSong('Push')
    await applySongLinkUpdate(userId, songId, [{ label: 'Share', url: SHORT }])

    const rows = await query<{ spotify_urls: string[] }>(
      `SELECT ${spotifyLinkUrlsJson('$1::uuid')} AS spotify_urls`,
      [songId],
    )

    expect(spotifyPushUris(rows.rows)).toEqual([`spotify:track:${TRACK_ID}`])
  })
})
