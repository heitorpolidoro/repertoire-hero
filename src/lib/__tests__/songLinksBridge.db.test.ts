/**
 * RH-136 — `reviewSongEdit` as a replace-set, the two bridge triggers, and the
 * Spotify import, against a real Postgres (ER14, ER17, ER18).
 *
 * The other half of the behaviour suite lives in `songLinksTable.db.test.ts`;
 * the seam is the subsystem under test and neither file may reach the hard
 * `max-lines` of 800 the complexity ratchet forbids overriding.
 *
 * THE TRIGGER IS WHY THIS FILE EXISTS AT ALL. It mirrors a `songs.links` write
 * made by code RH-136 may not edit — `findOrCreateSong`'s append in
 * `spotifyPlaylistSync.ts` — into `song_links`, so the Spotify link stays
 * visible on the song page. Its `position` expression is the single most
 * dangerous detail in the migration: uncoalesced, `max(position)` over zero rows
 * is NULL and the NOT NULL column raises `23502` on **every** firing for a song
 * with no `song_links` row yet, which is `scripts/seed-catalog.sql`'s insert
 * shape and the ordinary case for the Spotify append. Cases (a) and (b) below
 * are the only ones that catch it, and neither is reachable through the other
 * three.
 *
 * THE REVERSE BRIDGE IS THE OTHER HALF, and it is load-bearing for a musician
 * today rather than for RH-137. The Spotify push reads the retained
 * `songs.links` column and matches a track by its url (RH-135, `5d602f7`), so
 * with the four owned writers moved onto `song_links` and nothing writing the
 * column back, every push for a song touched after this migration would send an
 * empty `uris` list and answer HTTP 200 with `{added: 0}` — the exact
 * silently-succeeding push RH-135 existed to remove. The reverse trigger
 * recomputes the column from the rows, so all four writers are covered by one
 * statement; `spotifyPushUris.db.test.ts` is where the end-to-end proof lives.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { query } from '@/lib/db'
import { createTestUser, deleteTestUser } from './test-helpers'
import { reviewSongEdit, submitSongEdit } from '../moderation'
import { findOrCreateSong } from '../spotifyPlaylistSync'
import type { SongLink } from '@/types/database'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const MIGRATION_SUFFIX = '_song_links.sql'

interface StoredLink {
  id: string
  url: string
  label: string
  provider: string
  position: number
}

const UA = 'https://tabs.example/rh136b-a'
const UB = 'https://youtu.be/rh136b-b'
const UC = 'https://open.spotify.com/track/rh136b-c'

describe.skipIf(!RUN_DB_TESTS)('the song_links bridge and the moderation replace-set (RH-136)', () => {
  const suffix = Date.now()
  let userId: string
  let adminId: string
  const createdSongIds = new Set<string>()

  const seedSong = async (label: string, links = '[]'): Promise<string> => {
    const res = await query<{ id: string }>(
      'INSERT INTO songs (title, artist, links) VALUES ($1, $2, $3::jsonb) RETURNING id',
      [`RH-136B ${label} ${suffix}`, `RH-136B Artist ${suffix}`, links],
    )
    createdSongIds.add(res.rows[0].id)
    return res.rows[0].id
  }

  const storedLinks = async (songId: string): Promise<StoredLink[]> => {
    const res = await query<StoredLink>(
      `SELECT id, url, label, provider, position FROM song_links
        WHERE song_id = $1 ORDER BY position, created_at, id`,
      [songId],
    )
    return res.rows
  }

  const setColumn = async (songId: string, links: SongLink[]) => {
    await query('UPDATE songs SET links = $1::jsonb WHERE id = $2', [JSON.stringify(links), songId])
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

  /** A pending correction, approved, returning the edit's final status. */
  const approveLinks = async (songId: string, links: SongLink[]): Promise<string> => {
    const edit = await submitSongEdit(userId, songId, { links })
    const reviewed = await reviewSongEdit(adminId, edit.id, 'approve')
    return reviewed.status
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh136-bridge-${suffix}@example.com` })
    adminId = await createTestUser({ email: `rh136-bridge-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminId])
  })

  afterAll(async () => {
    if (createdSongIds.size > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1)', [Array.from(createdSongIds)])
    }
    if (userId) await deleteTestUser(userId)
    if (adminId) await deleteTestUser(adminId)
  })

  describe('reviewSongEdit applies an approved links array as a replace-set (ER14)', () => {
    it('drops the removed url, keeps every survivor song_links.id and approves the edit', async () => {
      const songId = await seedSong('Replace Set')
      await setColumn(songId, [
        { label: 'A', url: UA },
        { label: 'B', url: UB },
      ])
      const before = await storedLinks(songId)
      expect(before.map((row) => row.url)).toEqual([UA, UB])

      expect(await approveLinks(songId, [{ label: 'A', url: UA }])).toBe('approved')

      const after = await storedLinks(songId)
      expect(after.map((row) => row.url)).toEqual([UA])
      expect(after[0].id).toBe(before.find((row) => row.url === UA)!.id)
    })

    it('accepts a correction proposing only links, with no 42601, and bumps the timestamp (ER14a)', async () => {
      const songId = await seedSong('Only Links')
      await setColumn(songId, [{ label: 'A', url: UA }])
      const before = await updatedAt(songId)

      expect(await approveLinks(songId, [{ label: 'A renamed', url: UA }])).toBe('approved')

      // The clause list is empty once `links` is partitioned out, which is a
      // 42601 for every shape but the inline-array one.
      expect((await storedLinks(songId))[0].label).toBe('A renamed')
      expect(await updatedAt(songId) > before).toBe(true)
    })

    it('collapses a duplicated url to the first label and still approves (ER14b)', async () => {
      const songId = await seedSong('Approved Duplicate')

      expect(
        await approveLinks(songId, [
          { label: 'first', url: UC },
          { label: 'second', url: UC },
        ]),
      ).toBe('approved')

      const rows = await storedLinks(songId)
      expect(rows).toHaveLength(1)
      expect(rows[0].label).toBe('first')
    })

    it('leaves a song zero rows for an approved empty array (ER14c)', async () => {
      const songId = await seedSong('Approved Empty')
      await setColumn(songId, [
        { label: 'A', url: UA },
        { label: 'B', url: UB },
      ])
      expect(await storedLinks(songId)).toHaveLength(2)

      expect(await approveLinks(songId, [])).toBe('approved')

      // `url <> ALL('{}')` is true for every row, so the DELETE takes all of
      // them and the insert issues nothing.
      expect(await storedLinks(songId)).toEqual([])
    })

    it('has authority over order: an approved reorder that drops one url (ER14d)', async () => {
      const songId = await seedSong('Approved Reorder')
      await setColumn(songId, [
        { label: 'A', url: UA },
        { label: 'B', url: UB },
        { label: 'C', url: UC },
      ])
      const before = await storedLinks(songId)
      expect(before.map((row) => row.url)).toEqual([UA, UB, UC])

      expect(
        await approveLinks(songId, [
          { label: 'C', url: UC },
          { label: 'A', url: UA },
        ]),
      ).toBe('approved')

      const after = await storedLinks(songId)
      // The approved array's url order, not the pre-approval order. With
      // `DO UPDATE SET label` alone this stays [UA, UC] and the reorder is
      // silently discarded while every other assertion here still passes.
      expect(after.map((row) => row.url)).toEqual([UC, UA])
      for (const url of [UA, UC]) {
        expect(after.find((row) => row.url === url)!.id).toBe(
          before.find((row) => row.url === url)!.id,
        )
      }
    })
  })

  describe('the bridge trigger (ER17)', () => {
    it('AFTER INSERT on a song with no song_links rows, carrying two links (ER17a)', async () => {
      // `scripts/seed-catalog.sql:20`'s shape exactly. Uncoalesced, this is a
      // 23502 and a fresh `docker compose` database comes up with no catalog.
      const res = await query<{ id: string }>(
        `INSERT INTO songs (title, artist, standard_key, links)
         VALUES ($1, $2, 'C', $3::jsonb) RETURNING id`,
        [
          `RH-136B Seed Shape ${suffix}`,
          `RH-136B Artist ${suffix}`,
          JSON.stringify([
            { label: 'A', url: UA },
            { label: 'B', url: UB },
          ]),
        ],
      )
      createdSongIds.add(res.rows[0].id)

      const rows = await storedLinks(res.rows[0].id)
      expect(rows.map((row) => row.url)).toEqual([UA, UB])
      expect(rows.map((row) => row.position)).toEqual([1, 2])
    })

    it('AFTER UPDATE on a song with zero song_links rows (ER17b)', async () => {
      // The found-song append shape of `findOrCreateSong`, whose
      // `song.links.some(...)` guard is false for an empty array — the ordinary
      // case for a catalog song without links, not an edge one.
      const songId = await seedSong('Spotify Append Shape')
      expect(await storedLinks(songId)).toHaveLength(0)

      await setColumn(songId, [{ label: 'Track Title', url: UC }])

      const rows = await storedLinks(songId)
      expect(rows).toHaveLength(1)
      expect(rows[0].position).toBe(1)
      expect(rows[0].provider).toBe('spotify')
    })

    it('appends one row with a strictly higher position, leaving a gap (ER17c)', async () => {
      // Seeded through the INSERT so the two existing rows sit at 1 and 2 —
      // the state the measurement below is taken from.
      const songId = await seedSong(
        'Append',
        JSON.stringify([
          { label: 'A', url: UA },
          { label: 'B', url: UB },
        ]),
      )
      const before = await storedLinks(songId)
      expect(before.map((row) => row.position)).toEqual([1, 2])

      await setColumn(songId, [
        { label: 'A', url: UA },
        { label: 'B', url: UB },
        { label: 'C', url: UC },
      ])

      const after = await storedLinks(songId)
      expect(after).toHaveLength(3)
      const added = after.find((row) => row.url === UC)!
      for (const row of before) {
        const survivor = after.find((candidate) => candidate.url === row.url)!
        expect(survivor.id).toBe(row.id)
        expect(survivor.label).toBe(row.label)
        expect(added.position).toBeGreaterThan(survivor.position)
      }
      // A gap is expected and acceptable — which is why `position` is not
      // unique: max 2 + ordinality 3 = 5.
      expect(added.position).toBe(5)
    })

    it('is idempotent: the identical UPDATE inserts nothing (ER17d)', async () => {
      const songId = await seedSong('Idempotent', JSON.stringify([{ label: 'A', url: UA }]))
      const links = [
        { label: 'A', url: UA },
        { label: 'B', url: UB },
      ]
      await setColumn(songId, links)
      const before = await storedLinks(songId)

      await setColumn(songId, links)

      expect(await storedLinks(songId)).toEqual(before)
    })

    it('is insert-only: an empty array inserts nothing and deletes nothing (ER17e)', async () => {
      const songId = await seedSong('Emptied', JSON.stringify([{ label: 'A', url: UA }]))
      const before = await storedLinks(songId)
      expect(before).toHaveLength(1)

      await setColumn(songId, [])

      // What makes the empty-column fixtures of ER9 and ER16 constructible —
      // and it survives the reverse bridge, because no `song_links` row
      // changed, so the reverse trigger never fired to put the column back.
      expect(await storedLinks(songId)).toEqual(before)
      expect(await columnLinks(songId)).toEqual([])
    })

    it('carries no WHEN (OLD. clause and coalesces the position expression (ER17)', () => {
      const dir = path.resolve(__dirname, '..', '..', '..', 'migrations')
      const names = fs.readdirSync(dir).filter((name) => name.endsWith(MIGRATION_SUFFIX))
      expect(names).toHaveLength(1)
      const sql = fs.readFileSync(path.join(dir, names[0]), 'utf8')

      // A `WHEN` referencing `OLD` on a trigger that also fires `AFTER INSERT`
      // fails at creation with 42P17 and would abort the whole migration, so
      // `song_links` would never exist.
      expect(sql).not.toContain('WHEN (OLD.')
      expect(sql).toMatch(/COALESCE\(\(SELECT max\(position\) FROM song_links WHERE song_id = NEW\.id\), 0\)/)
    })
  })

  describe('the reverse bridge trigger: song_links back into songs.links', () => {
    it('mirrors an inserted row into the column, and recursion terminates', async () => {
      const songId = await seedSong('Reverse Insert')
      expect(await columnLinks(songId)).toEqual([])

      await query('INSERT INTO song_links (song_id, url, label, position) VALUES ($1, $2, $3, 1)', [
        songId,
        UA,
        'Tabs',
      ])

      expect(await columnLinks(songId)).toEqual([{ label: 'Tabs', url: UA }])
      // The reverse trigger's `UPDATE songs` fires the forward trigger, whose
      // insert is `ON CONFLICT DO NOTHING`; a row it suppresses fires no
      // `AFTER INSERT`, so the cycle closes after one turn and no duplicate
      // row appears.
      expect(await storedLinks(songId)).toHaveLength(1)
    })

    it('mirrors the canonical read order, not the insertion order', async () => {
      const songId = await seedSong('Reverse Order')
      await query(
        `INSERT INTO song_links (song_id, url, label, position)
         VALUES ($1, $2, 'Second', 2), ($1, $3, 'First', 1)`,
        [songId, UB, UA],
      )

      expect(await columnLinks(songId)).toEqual([
        { label: 'First', url: UA },
        { label: 'Second', url: UB },
      ])
    })

    it('mirrors a position rewrite, so an approved reorder reaches the column', async () => {
      const songId = await seedSong('Reverse Reorder')
      await query(
        `INSERT INTO song_links (song_id, url, label, position)
         VALUES ($1, $2, 'A', 1), ($1, $3, 'B', 2)`,
        [songId, UA, UB],
      )

      await query('UPDATE song_links SET position = 0 WHERE song_id = $1 AND url = $2', [
        songId,
        UB,
      ])

      expect(await columnLinks(songId)).toEqual([
        { label: 'B', url: UB },
        { label: 'A', url: UA },
      ])
    })

    it('mirrors a delete, and empties the column when the last row goes', async () => {
      const songId = await seedSong('Reverse Delete')
      await query(
        `INSERT INTO song_links (song_id, url, label, position)
         VALUES ($1, $2, 'A', 1), ($1, $3, 'B', 2)`,
        [songId, UA, UB],
      )

      await query('DELETE FROM song_links WHERE song_id = $1 AND url = $2', [songId, UA])
      expect(await columnLinks(songId)).toEqual([{ label: 'B', url: UB }])

      // A deleted url must not come back: the reverse trigger rewrites the
      // column from the surviving rows, and the forward trigger it fires can
      // only insert what the column now holds.
      await query('DELETE FROM song_links WHERE song_id = $1', [songId])
      expect(await columnLinks(songId)).toEqual([])
      expect(await storedLinks(songId)).toHaveLength(0)
    })

    it('is created after the backfill, so the migration leaves the column byte-identical', () => {
      const dir = path.resolve(__dirname, '..', '..', '..', 'migrations')
      const names = fs.readdirSync(dir).filter((name) => name.endsWith(MIGRATION_SUFFIX))
      expect(names).toHaveLength(1)
      const sql = fs.readFileSync(path.join(dir, names[0]), 'utf8')

      // With the reverse trigger already in place, the backfill's
      // `INSERT INTO song_links` would rewrite `songs.links` for every song in
      // the catalog — collapsing duplicates and dropping malformed elements —
      // and ER4's byte-identical column would be false.
      const backfill = sql.indexOf('INSERT INTO song_links (song_id, url, label, position)')
      const reverseTrigger = sql.indexOf('CREATE TRIGGER mirror_column_on_song_links_write')
      expect(backfill).toBeGreaterThan(-1)
      expect(reverseTrigger).toBeGreaterThan(backfill)
    })
  })

  describe('the Spotify import keeps its link visible (ER18)', () => {
    it('leaves the imported url in song_links with provider spotify', async () => {
      const title = `RH-136B Import ${suffix}`
      const artist = `RH-136B Import Artist ${suffix}`
      const songId = await seedSong('Import Target')
      // `findOrCreateSong` resolves by (artist, title), so the seeded row has
      // to carry the identity the track will resolve to.
      await query('UPDATE songs SET title = $1, artist = $2 WHERE id = $3', [title, artist, songId])
      expect(await storedLinks(songId)).toHaveLength(0)

      const resolved = await findOrCreateSong({
        spotifyTrackId: `rh136b-${suffix}`,
        title,
        artist,
        album: null,
        albumArt: null,
        spotifyUrl: UC,
        durationSeconds: 210,
      })

      expect(resolved.songId).toBe(songId)
      const rows = await storedLinks(songId)
      expect(rows.map((row) => row.url)).toEqual([UC])
      expect(rows[0].provider).toBe('spotify')
      expect(rows[0].label).toBe(title)
    })
  })
})
