/**
 * RH-126 — one write reaches exactly one owner, against real Postgres.
 *
 * The rule: a band-context write creates the band's `band_songs` row and
 * nothing else; a personal-context write creates the member's `user_songs` row
 * and nothing else. Two call sites used to write both for one act — the band
 * branch of `ensureInRepertoire` (a row for *every* `band_members` row) and the
 * band branch of `addSongToPlaylist` (a row for the acting admin) — and this
 * file is the conservation identity that keeps them gone.
 *
 * **Every band fixture here carries at least two members**, the acting admin
 * plus one plain member: a one-member band makes a fan-out invisible, because
 * the actor's own row is indistinguishable from a legitimate personal add. For
 * the same reason the counts are taken over the whole `version_id` rather than
 * over the actor, so another member's row cannot go unmeasured.
 *
 * The last three cases are the deliberate per-musician exceptions
 * (`docs/use-cases.md` § *What creates a personal row in band context*): a file
 * upload, a personal lyrics version and a `last_practiced` patch each write the
 * musician's own row in band context. Each still has exactly one owner, so the
 * rule holds — and each is asserted here so removing the fan-out cannot quietly
 * take them with it. The lyrics one is pure and lives in
 * `src/lib/__tests__/lyricsEditor.test.ts`.
 *
 * Gated on `RUN_DB_TESTS` like every other DB-backed suite: `npm run
 * test:coverage` sets none, so this file only runs under an explicit
 * `RUN_DB_TESTS=1` invocation.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The only mocked seams: the session, the Spotify token, `fetch`, the blob
// store and the logger. Every row below is written by the real code path.
vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/spotifyAuth', () => ({ getSpotifyAccessToken: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn() }))

import { POST as importPOST } from '@/app/api/spotify/playlists/[id]/import/route'
import { uploadTabAction } from '@/app/actions/tabs'
import { getRequiredUserId } from '@/lib/auth-session'
import { createBand } from '@/lib/bands'
import { query } from '@/lib/db'
import { updateSongOverrides } from '@/lib/ownerSongs'
import { addSongToPlaylist } from '@/lib/playlists'
import { getSpotifyAccessToken } from '@/lib/spotifyAuth'
import { put } from '@vercel/blob'
import { createTestUser, deleteTestUser, representativeVersionId } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const suffix = Date.now()

/** A two-track Spotify playlist for the personal-import case (ER5). */
const TWO_TRACK_TITLES = [`RH-126 Import One ${suffix}`, `RH-126 Import Two ${suffix}`]
const IMPORT_ARTIST = `RH-126 Import Artist ${suffix}`

const twoTrackPage = {
  items: TWO_TRACK_TITLES.map((title, index) => ({
    track: {
      id: `rh126track${index}`,
      name: title,
      duration_ms: 180000,
      artists: [{ name: IMPORT_ARTIST }],
      album: { name: `RH-126 Album ${suffix}`, images: [] as Array<{ url: string }> },
      external_urls: { spotify: `https://open.spotify.com/track/rh126track${index}` },
    },
  })),
  next: null,
}

describe.skipIf(!RUN_DB_TESTS)('one write reaches exactly one owner (real database)', () => {
  let adminId: string
  let memberId: string
  let bandId: string
  let bandPlaylistId: string
  let personalPlaylistId: string

  const createdSongs: string[] = []

  const asUser = (userId: string) => {
    vi.mocked(getRequiredUserId).mockResolvedValue(userId)
  }

  const count = async (sql: string, params: unknown[] = []): Promise<number> => {
    const res = await query<{ count: number }>(sql, params as never)
    return res.rows[0].count
  }

  /** A fresh catalog row, tracked for teardown. */
  const newSong = async (title: string): Promise<string> => {
    const res = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [title, `RH-126 Artist ${suffix}`],
    )
    const id = res.rows[0].id
    createdSongs.push(id)
    return id
  }

  beforeAll(async () => {
    adminId = await createTestUser({ email: `rh126-admin-${suffix}@example.com` })
    memberId = await createTestUser({ email: `rh126-member-${suffix}@example.com` })

    // `create_band` makes its caller the admin; the second user joins as a
    // plain member, so the band has the two owners the rule has to separate.
    bandId = await createBand(adminId, `RH-126 Band ${suffix}`, null, null)
    await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [
      bandId,
      memberId,
    ])

    const bandPlaylist = await query<{ id: string }>(
      'INSERT INTO playlists (band_id, name) VALUES ($1, $2) RETURNING id',
      [bandId, `RH-126 Band Setlist ${suffix}`],
    )
    bandPlaylistId = bandPlaylist.rows[0].id

    const personalPlaylist = await query<{ id: string }>(
      'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
      [adminId, `RH-126 Personal Setlist ${suffix}`],
    )
    personalPlaylistId = personalPlaylist.rows[0].id
  })

  beforeEach(() => {
    vi.mocked(getSpotifyAccessToken).mockResolvedValue('rh126-access-token')
    vi.mocked(put).mockResolvedValue({
      url: 'https://blob.example.test/rh126/chart.pdf',
      downloadUrl: 'https://blob.example.test/rh126/chart.pdf',
      pathname: 'rh126/chart.pdf',
      contentType: 'application/pdf',
      contentDisposition: 'inline; filename="chart.pdf"',
    } as Awaited<ReturnType<typeof put>>)
  })

  afterAll(async () => {
    vi.restoreAllMocks()

    await query('DELETE FROM playlists WHERE id = ANY($1)', [
      [bandPlaylistId, personalPlaylistId].filter(Boolean),
    ])
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const user of [adminId, memberId]) {
      if (user) await deleteTestUser(user)
    }
    if (createdSongs.length > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1)', [createdSongs])
    }
    await query('DELETE FROM songs WHERE artist = $1', [IMPORT_ARTIST])
  })

  // -------------------------------------------------------------------------
  // The rule itself.
  // -------------------------------------------------------------------------

  it('adding to a band playlist writes the band row and no member row', async () => {
    const songId = await newSong(`RH-126 Band Playlist Song ${suffix}`)
    const versionId = await representativeVersionId(songId)

    await addSongToPlaylist(bandPlaylistId, adminId, versionId)

    expect(
      await count('SELECT count(*)::int AS count FROM band_songs WHERE band_id = $1 AND version_id = $2', [
        bandId,
        versionId,
      ]),
    ).toBe(1)
    // Over every user, not just the actor: the fan-out seeded the whole band.
    expect(await count('SELECT count(*)::int AS count FROM user_songs WHERE version_id = $1', [versionId])).toBe(0)
    expect(
      await count(
        'SELECT count(*)::int AS count FROM playlist_songs WHERE playlist_id = $1 AND version_id = $2',
        [bandPlaylistId, versionId],
      ),
    ).toBe(1)
  })

  it('adding to a personal playlist writes the user row and no band row', async () => {
    const songId = await newSong(`RH-126 Personal Playlist Song ${suffix}`)
    const versionId = await representativeVersionId(songId)

    await addSongToPlaylist(personalPlaylistId, adminId, versionId)

    expect(
      await count('SELECT count(*)::int AS count FROM user_songs WHERE user_id = $1 AND version_id = $2', [
        adminId,
        versionId,
      ]),
    ).toBe(1)
    expect(await count('SELECT count(*)::int AS count FROM band_songs WHERE version_id = $1', [versionId])).toBe(0)
    expect(
      await count(
        'SELECT count(*)::int AS count FROM playlist_songs WHERE playlist_id = $1 AND version_id = $2',
        [personalPlaylistId, versionId],
      ),
    ).toBe(1)
  })

  it("a personal Spotify import writes only the importer's rows", async () => {
    asUser(adminId)
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/tracks')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(twoTrackPage) } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ name: `RH-126 Imported ${suffix}`, description: null, images: [] }),
      } as Response)
    })

    const ownBefore = await count('SELECT count(*)::int AS count FROM user_songs WHERE user_id = $1', [adminId])
    const bandBefore = await count(
      'SELECT count(*)::int AS count FROM band_songs WHERE band_id = $1',
      [bandId],
    )

    const response = await importPOST(
      new NextRequest(new URL('http://localhost/api/spotify/playlists/rh126-personal/import'), {
        method: 'POST',
        body: JSON.stringify({ sync_with_spotify: false }),
      }),
      { params: Promise.resolve({ id: 'rh126-personal' }) },
    )
    expect(response.status).toBe(201)
    const playlist = (await response.json()) as { id: string }

    // The version ids this import actually created, read before the playlist is
    // cleaned up. The `band_songs` before/after pair above is scoped to the band
    // this suite seeded (`WHERE band_id = $1`, RH-105 / ER14). It used to be an
    // unscoped global count, which made the whole file nondeterministic: the DB
    // suites run in parallel threads (`vitest.config.ts` fixes no
    // `fileParallelism`) and other files insert and delete `band_songs` under the
    // same `RUN_DB_TESTS=1`, so the difference measured other workers as much as
    // the import under test and drifted in both directions. Scoped to `bandId`
    // the pair still says "this personal import wrote no row to the band the
    // actor administers", which is the conservation fact it was always for, and
    // the `version_id = ANY($1)` assertion below still covers the general
    // one-owner invariant over the versions this import actually created.
    const importedVersions = await query<{ version_id: string }>(
      'SELECT version_id FROM playlist_songs WHERE playlist_id = $1',
      [playlist.id],
    )
    const importedVersionIds = importedVersions.rows.map((r) => r.version_id)

    await query('DELETE FROM playlist_songs WHERE playlist_id = $1', [playlist.id])
    await query('DELETE FROM playlists WHERE id = $1', [playlist.id])

    const ownAfter = await count('SELECT count(*)::int AS count FROM user_songs WHERE user_id = $1', [adminId])
    const bandAfter = await count(
      'SELECT count(*)::int AS count FROM band_songs WHERE band_id = $1',
      [bandId],
    )

    expect(ownAfter - ownBefore).toBe(2)
    expect(importedVersionIds).toHaveLength(2)
    expect(
      await count('SELECT count(*)::int AS count FROM band_songs WHERE version_id = ANY($1)', [
        importedVersionIds,
      ]),
    ).toBe(0)
    expect(bandAfter).toBe(bandBefore)

    fetchSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // The three deliberate exceptions. Each writes the musician's own row in
  // band context, and each still has exactly one owner.
  // -------------------------------------------------------------------------

  it("uploading a file in band context creates the uploader's own row", async () => {
    const songId = await newSong(`RH-126 Upload Song ${suffix}`)
    const versionId = await representativeVersionId(songId)

    // The band holds the song; nobody holds it personally.
    await query("INSERT INTO band_songs (band_id, version_id, status) VALUES ($1, $2, 'unknown')", [
      bandId,
      versionId,
    ])
    expect(await count('SELECT count(*)::int AS count FROM user_songs WHERE version_id = $1', [versionId])).toBe(0)

    asUser(memberId)
    const formData = new FormData()
    formData.set('songId', songId)
    formData.set('title', 'RH-126 Chart')
    formData.set(
      'file',
      new File([new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n'))], 'chart.pdf', {
        type: 'application/pdf',
      }),
    )

    const result = await uploadTabAction(formData)
    expect(result.error).toBeUndefined()
    expect(result.data?.song_id).toBe(songId)

    const own = await query<{ count: number; status: string }>(
      "SELECT count(*)::int AS count, min(status::text) AS status FROM user_songs WHERE user_id = $1 AND version_id = $2",
      [memberId, versionId],
    )
    expect(own.rows[0].count).toBe(1)
    expect(own.rows[0].status).toBe('unknown')

    // The other member received nothing, and the band's row is untouched.
    expect(await count('SELECT count(*)::int AS count FROM user_songs WHERE version_id = $1', [versionId])).toBe(1)
    expect(
      await count('SELECT count(*)::int AS count FROM band_songs WHERE band_id = $1 AND version_id = $2', [
        bandId,
        versionId,
      ]),
    ).toBe(1)
  })

  it('a last_practiced write in band context touches one owner row only', async () => {
    const songId = await newSong(`RH-126 Practice Song ${suffix}`)
    const versionId = await representativeVersionId(songId)

    await query("INSERT INTO band_songs (band_id, version_id, status) VALUES ($1, $2, 'unknown')", [
      bandId,
      versionId,
    ])
    const ownRow = await query<{ id: string }>(
      "INSERT INTO user_songs (user_id, version_id, status) VALUES ($1, $2, 'unknown') RETURNING id",
      [memberId, versionId],
    )
    const practisedAt = '2026-02-03T00:00:00.000Z'

    await updateSongOverrides({ userId: memberId }, ownRow.rows[0].id, { last_practiced: practisedAt })

    const own = await query<{ last_practiced: Date | null }>(
      'SELECT last_practiced FROM user_songs WHERE id = $1',
      [ownRow.rows[0].id],
    )
    expect(own.rows[0].last_practiced).not.toBeNull()
    expect(new Date(own.rows[0].last_practiced as Date).toISOString()).toBe(practisedAt)

    const band = await query<{ last_practiced: Date | null }>(
      'SELECT last_practiced FROM band_songs WHERE band_id = $1 AND version_id = $2',
      [bandId, versionId],
    )
    expect(band.rows[0].last_practiced).toBeNull()
  })
})
