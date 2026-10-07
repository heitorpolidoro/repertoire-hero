/**
 * RH-136 — the three migrated reads and the song-side writers, against a real
 * Postgres (ER9, ER11-ER13, ER15, ER16, ER19's runtime half).
 *
 * Split from `songLinksBridge.db.test.ts` up front and deliberately: one file
 * would have carried roughly twenty DB scenarios against a hard `max-lines` of
 * 800 that the complexity ratchet forbids overriding, and a suite that outgrows
 * that ceiling mid-implementation has no legal remedy left. The seam is the
 * subsystem under test — the song-side writers in `songs.ts` / `songIdentity.ts`
 * here, `moderation.ts` plus the database-level bridge there. Each file carries
 * its own fixtures; nothing is shared across the two beyond `test-helpers.ts`.
 *
 * Every fixture that needs a `songs.links` column **out of step** with
 * `song_links` is built by seeding `song_links` directly while the column stays
 * `'[]'::jsonb`. That is constructible only because the bridge trigger is
 * insert-only and an empty array inserts nothing, so no firing of it can ever
 * contradict the column.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestUser, deleteTestUser, representativeVersionId, seedOwnerSong } from './test-helpers'

// `applySongLinkUpdate` auto-labels a blank label through `fetchUrlTitle`; the
// network is never touched from a test.
vi.mock('@/lib/linkFetcher', () => ({ fetchUrlTitle: vi.fn() }))

import { fetchUrlTitle } from '@/lib/linkFetcher'
import { query, withTransaction } from '@/lib/db'
import { applyCatalogFill, applySongLinkUpdate, type SongUpdateInput } from '../songs'
import { resolveOrCreateSongIdentity } from '../songIdentity'
import { getRepertoire, updateSong } from '../ownerSongs'
import { getPendingSongEdits } from '../moderation'
import { createPlaylist, addSongToPlaylist, getPlaylistWithSongs } from '../playlists'
import type { Repertoire, SongLink } from '@/types/database'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

/** One `song_links` row as every assertion below reads it. */
interface StoredLink {
  id: string
  url: string
  label: string
  provider: string
  position: number
}

const U1 = 'https://tabs.example/rh136-u1'
const U2 = 'https://youtu.be/rh136-u2'
const U3 = 'https://open.spotify.com/track/rh136-u3'

describe.skipIf(!RUN_DB_TESTS)('song_links reads and the song-side writers (RH-136)', () => {
  const suffix = Date.now()
  let userId: string
  let adminId: string
  const createdSongIds = new Set<string>()
  const createdPlaylistIds = new Set<string>()

  /** A catalog row whose `links` column is whatever the caller seeds. */
  const seedSong = async (label: string, links = '[]'): Promise<string> => {
    const res = await query<{ id: string }>(
      'INSERT INTO songs (title, artist, links) VALUES ($1, $2, $3::jsonb) RETURNING id',
      [`RH-136 ${label} ${suffix}`, `RH-136 Artist ${suffix}`, links],
    )
    createdSongIds.add(res.rows[0].id)
    return res.rows[0].id
  }

  /**
   * Seeds `song_links` rows by hand.
   *
   * The reverse bridge trigger mirrors them into `songs.links`, so a caller
   * that needs the deliberately-empty column of ER9 and ER16 blanks it
   * **afterwards** with {@link blankColumn} — which the forward trigger leaves
   * standing, because an empty array inserts nothing and changes no row.
   */
  const seedLinkRows = async (songId: string, links: Array<[string, string, number]>) => {
    for (const [url, label, position] of links) {
      await query('INSERT INTO song_links (song_id, url, label, position) VALUES ($1, $2, $3, $4)', [
        songId,
        url,
        label,
        position,
      ])
    }
  }

  /**
   * Empties `songs.links` while the song's `song_links` rows stay.
   *
   * Holds, rather than being undone by either trigger: the forward bridge is
   * insert-only and inserts nothing from `'[]'`, so no `song_links` row
   * changes and the reverse bridge never fires.
   */
  const blankColumn = async (songId: string): Promise<void> => {
    await query(`UPDATE songs SET links = '[]'::jsonb WHERE id = $1`, [songId])
  }

  /** The canonical read order, with no exception: position, created_at, id. */
  const storedLinks = async (songId: string): Promise<StoredLink[]> => {
    const res = await query<StoredLink>(
      `SELECT id, url, label, provider, position FROM song_links
        WHERE song_id = $1 ORDER BY position, created_at, id`,
      [songId],
    )
    return res.rows
  }

  const columnLinks = async (songId: string): Promise<unknown> => {
    const res = await query<{ links: unknown }>('SELECT links FROM songs WHERE id = $1', [songId])
    return res.rows[0].links
  }

  const updatedAt = async (songId: string): Promise<string> => {
    const res = await query<{ updated_at: string }>(
      'SELECT updated_at::text AS updated_at FROM songs WHERE id = $1',
      [songId],
    )
    return res.rows[0].updated_at
  }

  const entryFor = async (songId: string): Promise<Repertoire> => {
    const entries = await getRepertoire({ userId })
    const found = entries.find((entry) => entry.song_id === songId)
    if (!found) throw new Error(`no repertoire entry for ${songId}`)
    return found
  }

  const proposal = (links: SongLink[]): SongUpdateInput => ({
    title: `RH-136 Proposal ${suffix}`,
    artist: `RH-136 Artist ${suffix}`,
    album: null,
    key: null,
    status: 'learning',
    tags: [],
    links,
  })

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh136-table-${suffix}@example.com` })
    adminId = await createTestUser({ email: `rh136-table-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminId])
  })

  beforeEach(() => {
    vi.mocked(fetchUrlTitle).mockReset()
  })

  afterAll(async () => {
    for (const id of createdPlaylistIds) await query('DELETE FROM playlists WHERE id = $1', [id])
    if (createdSongIds.size > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1)', [Array.from(createdSongIds)])
    }
    if (userId) await deleteTestUser(userId)
    if (adminId) await deleteTestUser(adminId)
  })

  describe('the three migrated reads (ER9)', () => {
    let songId: string

    beforeAll(async () => {
      // The discriminating fixture: the column stays empty while the table
      // holds the real links, so a reader still projecting `s.links` returns
      // `[]` and fails here.
      songId = await seedSong('Read Fixture')
      await seedLinkRows(songId, [
        [U1, 'Chords', 1],
        [U2, 'Video', 2],
      ])
      await blankColumn(songId)
      expect(await columnLinks(songId)).toEqual([])
    })

    it('getRepertoire returns both links with their provider, in position order', async () => {
      await seedOwnerSong({ userId }, songId)
      const entry = await entryFor(songId)
      expect(entry.song!.links).toEqual([
        { label: 'Chords', url: U1, provider: 'other' },
        { label: 'Video', url: U2, provider: 'youtube' },
      ])
    })

    it('getPlaylistWithSongs returns both links with their provider, in position order', async () => {
      const versionId = await representativeVersionId(songId)
      const playlist = await createPlaylist(userId, { name: `RH-136 Playlist ${suffix}` })
      createdPlaylistIds.add(playlist.id)
      await addSongToPlaylist(playlist.id, userId, versionId)

      const loaded = await getPlaylistWithSongs(playlist.id, userId)
      const entry = loaded!.songs!.find((candidate) => candidate.song!.id === songId)
      expect(entry!.song!.links).toEqual([
        { label: 'Chords', url: U1, provider: 'other' },
        { label: 'Video', url: U2, provider: 'youtube' },
      ])
    })

    it('getPendingSongEdits returns both links with their provider, in position order', async () => {
      await query(
        `INSERT INTO global_song_edits (song_id, requested_by, proposed_data, status)
         VALUES ($1, $2, $3::jsonb, 'pending')`,
        [songId, userId, JSON.stringify({ title: `RH-136 Corrected ${suffix}` })],
      )
      const edits = await getPendingSongEdits(adminId)
      const edit = edits.find((candidate) => candidate.song_id === songId)
      expect(edit!.song!.links).toEqual([
        { label: 'Chords', url: U1, provider: 'other' },
        { label: 'Video', url: U2, provider: 'youtube' },
      ])
    })
  })

  describe('applySongLinkUpdate', () => {
    /**
     * A song whose `song_links` rows were produced by the bridge trigger and
     * therefore carry a **gap**: `u1` at position 1, `u2` at position 3
     * (`max` 1 + ordinality 2). Built exactly as ER17 builds it, because the
     * gap is what makes `position = EXCLUDED.position` observable.
     */
    const songWithTriggerGap = async (label: string): Promise<string> => {
      const songId = await seedSong(label, JSON.stringify([{ label: 'Chords', url: U1 }]))
      await query('UPDATE songs SET links = $1::jsonb WHERE id = $2', [
        JSON.stringify([
          { label: 'Chords', url: U1 },
          { label: 'Video', url: U2 },
        ]),
        songId,
      ])
      const seeded = await storedLinks(songId)
      expect(seeded.map((row) => row.position)).toEqual([1, 3])
      return songId
    }

    it('adds a link, preserves the submitted order and mirrors it into the column (ER11)', async () => {
      const songId = await songWithTriggerGap('Additive')
      const before = await storedLinks(songId)

      await expect(
        applySongLinkUpdate(userId, songId, [
          { label: 'Chords', url: U1 },
          { label: 'Video', url: U2 },
          { label: 'Spotify', url: U3 },
        ]),
      ).resolves.toEqual({ success: true })

      const after = await storedLinks(songId)
      // The discriminating assertion: the submitted array's url order, read
      // back through the canonical order. With `DO UPDATE SET label` alone the
      // survivors keep 1 and 3 while the new row is given 3 — tied with `u2`,
      // and the tie breaks on a random uuid.
      expect(after.map((row) => row.url)).toEqual([U1, U2, U3])
      expect(after.find((row) => row.url === U3)!.label).toBe('Spotify')
      // Every other row's position is strictly lower than the new one's.
      const newPosition = after.find((row) => row.url === U3)!.position
      for (const row of after.filter((candidate) => candidate.url !== U3)) {
        expect(row.position).toBeLessThan(newPosition)
      }
      // The surviving rows keep their identity: nothing was deleted and
      // reinserted.
      for (const url of [U1, U2]) {
        expect(after.find((row) => row.url === url)!.id).toBe(
          before.find((row) => row.url === url)!.id,
        )
      }
      // ER11 as written required `songs.links` to come back **unmodified**,
      // under the spec's premise that nothing reads the retained column any
      // more. RH-135 falsified that premise one commit earlier: the Spotify
      // push reads `songs.links` and matches by url, so a column this writer
      // left empty makes the push send zero uris and answer 200. The reverse
      // bridge trigger therefore mirrors the rows back, and the column's
      // correct value here is the submitted set in canonical read order — the
      // assertion that actually protects the push. See the RH-136 report: ER11
      // needs this clause amended.
      expect(await columnLinks(songId)).toEqual([
        { label: 'Chords', url: U1 },
        { label: 'Video', url: U2 },
        { label: 'Spotify', url: U3 },
      ])
    })

    it('rewrites a label on an otherwise additive submission (ER12a)', async () => {
      const songId = await songWithTriggerGap('Label Rewrite')

      await expect(
        applySongLinkUpdate(userId, songId, [
          { label: 'Chords (fixed)', url: U1 },
          { label: 'Video', url: U2 },
        ]),
      ).resolves.toEqual({ success: true })

      expect((await storedLinks(songId)).find((row) => row.url === U1)!.label).toBe(
        'Chords (fixed)',
      )
    })

    it('collapses a duplicated url to the first label instead of aborting (ER12b)', async () => {
      const songId = await seedSong('Duplicate Submission')

      await expect(
        applySongLinkUpdate(userId, songId, [
          { label: 'first', url: U3 },
          { label: 'second', url: U3 },
        ]),
      ).resolves.toEqual({ success: true })

      // Unguarded this raises 21000 under `DO UPDATE` and 23505 plain.
      const rows = await storedLinks(songId)
      expect(rows).toHaveLength(1)
      expect(rows[0].label).toBe('first')
      expect(rows[0].provider).toBe('spotify')
    })

    it('queues a removal and writes nothing at all (ER13)', async () => {
      const songId = await songWithTriggerGap('Removal')
      const before = await storedLinks(songId)

      await expect(
        applySongLinkUpdate(userId, songId, [{ label: 'Chords', url: U1 }]),
      ).resolves.toEqual({ success: true, pending: true })

      expect(await storedLinks(songId)).toEqual(before)
      const edits = await query<{ proposed_data: unknown }>(
        "SELECT proposed_data FROM global_song_edits WHERE song_id = $1 AND status = 'pending'",
        [songId],
      )
      expect(edits.rows).toEqual([{ proposed_data: { links: [{ label: 'Chords', url: U1 }] } }])
    })

    it('bumps the catalog timestamp on an additive write (ER19)', async () => {
      const songId = await songWithTriggerGap('Timestamp')
      const before = await updatedAt(songId)

      await applySongLinkUpdate(userId, songId, [
        { label: 'Chords', url: U1 },
        { label: 'Video', url: U2 },
        { label: 'Spotify', url: U3 },
      ])

      expect(await updatedAt(songId) > before).toBe(true)
    })
  })

  describe('resolveOrCreateSongIdentity (ER15)', () => {
    it('writes a created row links in input order and returns them', async () => {
      const links = [
        { label: 'Video', url: U2 },
        { label: 'Chords', url: U1 },
      ]
      const resolved = await resolveOrCreateSongIdentity({
        title: `RH-136 Created ${suffix}`,
        artist: `RH-136 Artist ${suffix}`,
        links,
      })
      createdSongIds.add(resolved.id)

      expect(resolved.created).toBe(true)
      expect(resolved.links).toEqual(links)
      expect((await storedLinks(resolved.id)).map((row) => row.url)).toEqual([U2, U1])
    })

    it('writes nothing for a found row and returns its current song_links', async () => {
      const songId = await seedSong('Found Identity')
      await seedLinkRows(songId, [[U1, 'Chords', 1]])
      const before = await storedLinks(songId)

      const resolved = await resolveOrCreateSongIdentity({
        title: `RH-136 Found Identity ${suffix}`,
        artist: `RH-136 Artist ${suffix}`,
        links: [{ label: 'Something else', url: U3 }],
      })

      expect(resolved).toEqual({
        id: songId,
        links: [{ label: 'Chords', url: U1, provider: 'other' }],
        created: false,
        label: null,
      })
      expect(await storedLinks(songId)).toEqual(before)
    })

    it('resolves a duplicated input url without aborting the caller transaction', async () => {
      const resolved = await withTransaction(async (client) => {
        const created = await resolveOrCreateSongIdentity(
          {
            title: `RH-136 Dup Identity ${suffix}`,
            artist: `RH-136 Artist ${suffix}`,
            links: [
              { label: 'first', url: U3 },
              { label: 'second', url: U3 },
            ],
          },
          client,
        )
        // The proof that nothing aborted: a further statement on the same
        // client. A caught 23505 or 21000 would leave the transaction in
        // 25P02 and this would fail.
        const probe = await client.query<{ ok: number }>('SELECT 1 AS ok', [])
        expect(probe.rows[0].ok).toBe(1)
        return created
      })
      createdSongIds.add(resolved.id)

      const rows = await storedLinks(resolved.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].label).toBe('first')
    })
  })

  describe('applyCatalogFill (ER16, ER19)', () => {
    it('refuses a different link against song_links, not against the empty column', async () => {
      const songId = await seedSong('Fill Refusal')
      await seedLinkRows(songId, [[U1, 'Chords', 1]])
      await blankColumn(songId)
      expect(await columnLinks(songId)).toEqual([])

      const refused = await withTransaction((client) =>
        applyCatalogFill(songId, proposal([{ label: 'Spotify', url: U3 }]), client),
      )

      expect(refused.map((field) => field.column)).toContain('links')
      // Refused means refused: nothing was filled in behind the musician.
      expect((await storedLinks(songId)).map((row) => row.url)).toEqual([U1])
    })

    it('fills a link-less song and the links come back through getRepertoire', async () => {
      const songId = await seedSong('Fill Empty')
      await seedOwnerSong({ userId }, songId)

      const refused = await withTransaction((client) =>
        applyCatalogFill(
          songId,
          proposal([
            { label: 'Chords', url: U1 },
            { label: 'Spotify', url: U3 },
          ]),
          client,
        ),
      )

      expect(refused.map((field) => field.column)).not.toContain('links')
      expect((await entryFor(songId)).song!.links).toEqual([
        { label: 'Chords', url: U1, provider: 'other' },
        { label: 'Spotify', url: U3, provider: 'spotify' },
      ])
    })

    it('bumps the catalog timestamp when links are the only written field (ER19)', async () => {
      const songId = await seedSong('Fill Timestamp')
      // Every other catalog column is already set, so `fill` carries `links`
      // and nothing else — the case whose clause list is empty and whose
      // `UPDATE songs SET , updated_at = now()` would be a 42601.
      await query(
        `UPDATE songs SET album = 'An Album', standard_key = 'C', cover_url = 'https://img.example/c',
                          duration_seconds = 120 WHERE id = $1`,
        [songId],
      )
      const before = await updatedAt(songId)

      await withTransaction((client) =>
        applyCatalogFill(songId, proposal([{ label: 'Chords', url: U1 }]), client),
      )

      expect(await updatedAt(songId) > before).toBe(true)
      expect((await storedLinks(songId)).map((row) => row.url)).toEqual([U1])
    })

    it('survives a duplicated url through updateSong and still commits the owner row (ER16)', async () => {
      const songId = await seedSong('Form Duplicate')
      const ownerRowId = await seedOwnerSong({ userId }, songId, { status: 'unknown' })
      const entry = await entryFor(songId)

      await expect(
        updateSong({ userId }, entry, {
          ...proposal([
            { label: 'first', url: U3 },
            { label: 'second', url: U3 },
          ]),
          status: 'mastered',
        }),
      ).resolves.toBeDefined()

      const rows = await storedLinks(songId)
      expect(rows).toHaveLength(1)
      expect(rows[0].label).toBe('first')
      // The owner half of the same transaction committed: against a naive
      // implementation the 23505/21000 takes it down with the links write and
      // the musician loses the whole edit.
      const owner = await query<{ status: string }>(
        'SELECT status::text AS status FROM user_songs WHERE id = $1',
        [ownerRowId],
      )
      expect(owner.rows[0].status).toBe('mastered')
    })
  })
})
