/**
 * RH-136 — an approved `links` correction as a replace-set, the two bridge
 * triggers, and the Spotify import, against a real Postgres (ER14, ER17, ER18).
 *
 * RH-107 replaced the queue with `catalog_suggestions`, so the replace-set is
 * reached through `reviewCatalogSuggestionGroup` by `group_id` now. Nothing
 * about the behaviour under test moved: `links` is still one proposable column
 * whose approved value is applied as a whole set.
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
 * THE REVERSE BRIDGE IS GONE (RH-137,
 * `migrations/0020_drop_song_links_reverse_bridge.sql`). It existed only
 * because the Spotify push still read the retained `songs.links` column; the
 * push is keyed off `song_links.provider` now, so the column has no production
 * reader and the dual write it forced is retired. What stands in its place here
 * is an absence assertion — schema-qualified, because the dev database carries
 * `mirror_*` copies in a leftover probe schema — plus the import case below,
 * which proves the column is left untouched on the very path the reverse
 * trigger was added for. `spotifyPushUris.db.test.ts` is where the end-to-end
 * proof that the push still works lives.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { query } from '@/lib/db'
import { createTestUser, deleteTestUser } from './test-helpers'
import { reviewCatalogSuggestionGroup, submitCatalogSuggestion } from '../moderation'
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

  /** A pending correction, approved, returning the suggestion's final status. */
  const approveLinks = async (songId: string, links: SongLink[]): Promise<string> => {
    const submitted = await submitCatalogSuggestion(userId, songId, { links })
    const reviewed = await reviewCatalogSuggestionGroup(adminId, submitted[0].group_id, 'approve')
    return reviewed[0].status
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

  describe('an approved links array is applied as a replace-set (ER14)', () => {
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

  describe('the reverse bridge trigger is gone (RH-137)', () => {
    it('has no reverse trigger and no reverse function, while the forward trigger stands', async () => {
      // All three predicates are schema-qualified. The dev database carries a
      // leftover `rh136rev` probe schema holding its own copies of the
      // `mirror_*` objects, so the unqualified counts are 2, 2 and 2 and would
      // hide exactly the change under test. Qualifying also pins each trigger
      // to the relation it belongs on, rather than to a name existing
      // somewhere in the cluster.
      const reverseTrigger = await query<{ count: string }>(
        `SELECT count(*) AS count FROM pg_trigger
          WHERE tgname = 'mirror_column_on_song_links_write'
            AND tgrelid = 'public.song_links'::regclass`,
      )
      expect(Number(reverseTrigger.rows[0].count)).toBe(0)

      const reverseFunction = await query<{ count: string }>(
        `SELECT count(*) AS count FROM pg_proc
          WHERE proname = 'mirror_column_from_song_links'
            AND pronamespace = 'public'::regnamespace`,
      )
      expect(Number(reverseFunction.rows[0].count)).toBe(0)

      // The forward bridge survives: RH-143 drops it with the column.
      const forwardTrigger = await query<{ count: string }>(
        `SELECT count(*) AS count FROM pg_trigger
          WHERE tgname = 'mirror_song_links_on_songs_write'
            AND tgrelid = 'public.songs'::regclass`,
      )
      expect(Number(forwardTrigger.rows[0].count)).toBe(1)
    })

    it('leaves songs.links alone when a song_links row is written', async () => {
      // With a row present for the dropped trigger to have fired on: a trigger
      // is not evaluated for a statement matching no row, so an assertion over
      // an untouched song would prove nothing.
      const songId = await seedSong('Reverse Gone')
      expect(await columnLinks(songId)).toEqual([])

      await query('INSERT INTO song_links (song_id, url, label, position) VALUES ($1, $2, $3, 1)', [
        songId,
        UA,
        'Tabs',
      ])

      expect((await storedLinks(songId)).map((row) => row.url)).toEqual([UA])
      expect(await columnLinks(songId)).toEqual([])
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

    it('appends at max(position) + 1, bumps updated_at and leaves songs.links untouched (RH-137)', async () => {
      const title = `RH-137 Import ${suffix}`
      const artist = `RH-137 Import Artist ${suffix}`
      const songId = await seedSong('Import Append Target')
      await query('UPDATE songs SET title = $1, artist = $2 WHERE id = $3', [title, artist, songId])

      // Two links already on the song, written through the column so the
      // forward bridge gives them positions 1 and 2 — the state `max(position)`
      // is read from.
      await setColumn(songId, [
        { label: 'A', url: UA },
        { label: 'B', url: UB },
      ])
      const before = await storedLinks(songId)
      expect(before.map((row) => row.position)).toEqual([1, 2])
      const seededColumn = await columnLinks(songId)
      const beforeUpdatedAt = await updatedAt(songId)

      const track = {
        spotifyTrackId: `rh137-${suffix}`,
        title,
        artist,
        album: null,
        albumArt: null,
        spotifyUrl: UC,
        durationSeconds: 210,
      }
      expect((await findOrCreateSong(track)).songId).toBe(songId)

      const after = await storedLinks(songId)
      expect(after.map((row) => row.url)).toEqual([UA, UB, UC])
      const appended = after.find((row) => row.url === UC)!
      expect(appended.position).toBe(3)
      expect(appended.provider).toBe('spotify')
      // Nothing was deleted and reinserted.
      for (const row of before) {
        expect(after.find((candidate) => candidate.url === row.url)!.id).toBe(row.id)
      }
      expect(await updatedAt(songId) > beforeUpdatedAt).toBe(true)

      // The cheapest demonstration that the reverse bridge is really gone, on
      // the very path that motivated it: the column keeps the value seeded
      // before the import, with no `UC` added to it.
      expect(await columnLinks(songId)).toEqual(seededColumn)
      expect(await columnLinks(songId)).toEqual([
        { label: 'A', url: UA },
        { label: 'B', url: UB },
      ])

      // Re-importing the same track adds no second row.
      await findOrCreateSong(track)
      expect(await storedLinks(songId)).toHaveLength(3)
    })
  })
})
