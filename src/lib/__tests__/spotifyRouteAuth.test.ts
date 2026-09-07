/**
 * RH-35 — unit tests for the `/api/spotify/playlists/[id]/*` authorization
 * prologue. No database: `@/lib/playlists` and `@/lib/bands` are mocked, so
 * what is under test is only the guard's own decision table (which refusal,
 * which status, which body) and the fact that a malformed id never reaches
 * Postgres at all.
 *
 * The two refusal branches of the pre-existing `resolveSpotifyRouteAccess()`
 * are covered here too: every other test of these routes mocks
 * `getRequiredUserId` / `getSpotifyAccessToken` into their happy path, so
 * without these cases those two `return`s are never executed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextResponse } from 'next/server'

vi.mock('@/lib/playlists', () => ({ assertPlaylistAccess: vi.fn() }))
vi.mock('@/lib/bands', () => ({ assertBandMember: vi.fn() }))
vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/spotifyAuth', () => ({ getSpotifyAccessToken: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

import { assertPlaylistAccess } from '@/lib/playlists'
import { assertBandMember } from '@/lib/bands'
import { getRequiredUserId } from '@/lib/auth-session'
import { getSpotifyAccessToken } from '@/lib/spotifyAuth'
import { logger } from '@/lib/logger'
import {
  resolveOwnedPlaylist,
  resolveBandOwnership,
  resolveSpotifyRouteAccess,
} from '../spotifyRouteAuth'

const PLAYLIST_ID = '11111111-2222-3333-4444-555555555555'
const BAND_ID = '66666666-7777-8888-9999-aaaaaaaaaaaa'
const USER_ID = 'user-1'

const GUARD_FAILED = { error: 'Unexpected error authorizing this request', code: 500 }

type GuardResult = { ok: true } | { ok: false; response: NextResponse }

/** Asserts a refusal carries exactly the status and body the routes promise. */
async function expectRefusal(
  result: GuardResult,
  status: number,
  body: Record<string, unknown>,
): Promise<void> {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected a refusal')
  expect(result.response.status).toBe(status)
  expect(await result.response.json()).toEqual(body)
}

describe('resolveOwnedPlaylist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the row the domain helper authorized', async () => {
    const row = { id: PLAYLIST_ID, user_id: USER_ID, band_id: null }
    vi.mocked(assertPlaylistAccess).mockResolvedValue(row)

    const result = await resolveOwnedPlaylist(PLAYLIST_ID, USER_ID)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.playlist).toEqual(row)
    expect(assertPlaylistAccess).toHaveBeenCalledWith(PLAYLIST_ID, USER_ID)
  })

  it('answers a fixed 404 when the caller is not allowed on the playlist', async () => {
    vi.mocked(assertPlaylistAccess).mockRejectedValue(
      new Error('Access denied: not allowed on this playlist'),
    )

    const result = await resolveOwnedPlaylist(PLAYLIST_ID, USER_ID)

    await expectRefusal(result, 404, { error: 'Playlist not found', code: 404 })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('answers the same 404 for a malformed id without querying the database', async () => {
    const result = await resolveOwnedPlaylist('not-a-uuid', USER_ID)

    await expectRefusal(result, 404, { error: 'Playlist not found', code: 404 })
    expect(vi.mocked(assertPlaylistAccess).mock.calls).toHaveLength(0)
  })

  it('answers 500 and logs once when the helper fails for a genuine reason', async () => {
    vi.mocked(assertPlaylistAccess).mockRejectedValue(
      new Error('Failed to authorize playlist access: boom'),
    )

    const result = await resolveOwnedPlaylist(PLAYLIST_ID, USER_ID)

    await expectRefusal(result, 500, GUARD_FAILED)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.error).mock.calls[0][0]).toBe('[spotify/playlists/authz]')
  })
})

describe('resolveBandOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves ok when the caller is a member of the band', async () => {
    vi.mocked(assertBandMember).mockResolvedValue('member')

    const result = await resolveBandOwnership(BAND_ID, USER_ID)

    expect(result).toEqual({ ok: true })
    expect(assertBandMember).toHaveBeenCalledWith(BAND_ID, USER_ID)
  })

  it('answers a fixed 404 when the caller is not a member', async () => {
    vi.mocked(assertBandMember).mockRejectedValue(
      new Error('Access denied: not a member of this band'),
    )

    const result = await resolveBandOwnership(BAND_ID, USER_ID)

    await expectRefusal(result, 404, { error: 'Band not found', code: 404 })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('answers the same 404 for a malformed band id without querying the database', async () => {
    const result = await resolveBandOwnership('not-a-uuid', USER_ID)

    await expectRefusal(result, 404, { error: 'Band not found', code: 404 })
    expect(vi.mocked(assertBandMember).mock.calls).toHaveLength(0)
  })

  it('answers 500 and logs once when the helper fails for a genuine reason', async () => {
    vi.mocked(assertBandMember).mockRejectedValue(
      new Error('Failed to check band membership: boom'),
    )

    const result = await resolveBandOwnership(BAND_ID, USER_ID)

    await expectRefusal(result, 500, GUARD_FAILED)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.error).mock.calls[0][0]).toBe('[spotify/playlists/authz]')
  })

  it('answers 500 for a non-Error rejection too', async () => {
    vi.mocked(assertBandMember).mockRejectedValue('a bare string')

    const result = await resolveBandOwnership(BAND_ID, USER_ID)

    await expectRefusal(result, 500, GUARD_FAILED)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})

describe('resolveSpotifyRouteAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the session user and their Spotify token', async () => {
    vi.mocked(getRequiredUserId).mockResolvedValue(USER_ID)
    vi.mocked(getSpotifyAccessToken).mockResolvedValue('token-abc')

    const result = await resolveSpotifyRouteAccess()

    expect(result).toEqual({ ok: true, userId: USER_ID, accessToken: 'token-abc' })
  })

  it('answers 401 Unauthorized when there is no session', async () => {
    vi.mocked(getRequiredUserId).mockRejectedValue(new Error('Unauthorized'))

    const result = await resolveSpotifyRouteAccess()

    await expectRefusal(result, 401, { error: 'Unauthorized', code: 401 })
  })

  it('answers 401 Spotify not connected when the user has no token', async () => {
    vi.mocked(getRequiredUserId).mockResolvedValue(USER_ID)
    vi.mocked(getSpotifyAccessToken).mockResolvedValue(null)

    const result = await resolveSpotifyRouteAccess()

    await expectRefusal(result, 401, { error: 'Spotify not connected', code: 401 })
  })
})
