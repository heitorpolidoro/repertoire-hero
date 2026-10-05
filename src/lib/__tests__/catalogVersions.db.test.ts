/**
 * RH-122 — `albums`, `song_versions` and the two write paths, against a real
 * Postgres.
 *
 * Everything here is an assertion a mocked `pg` cannot make. The two uniques
 * are the load-bearing part of the new schema and only the database enforces
 * them; "exactly one `albums` row after importing the same track twice" is a
 * `SELECT count(*)`, not a canned mock reply; and the plpgsql halves of the
 * title split have to agree with `src/lib/songTitle.ts` on every pinned case,
 * which is a comparison between two engines.
 *
 * The migration's own backfill and collapse live in
 * `catalogVersionsMigration.db.test.ts`.
 *
 * It skips visibly without `RUN_DB_TESTS`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { createAndAddSong } from '@/lib/songs'
import { findOrCreateSong } from '@/lib/spotifyPlaylistSync'
import type { SpotifyRawTrack } from '@/lib/spotifyPlaylistSync'
import { splitSongTitle } from '@/lib/songTitle'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

/** A collision-free token, free of the `" - "` separator and of dashes. */
function token(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

function spotifyTrack(overrides: Partial<SpotifyRawTrack>): SpotifyRawTrack {
  return {
    spotifyTrackId: 'track-1',
    title: 'Track',
    artist: 'Artist',
    album: null,
    albumArt: null,
    spotifyUrl: 'https://open.spotify.com/track/track-1',
    durationSeconds: null,
    ...overrides,
  }
}

/** `SELECT count(*)` — the point of these suites: a real count, never a mock reply. */
async function countOf(table: string, where: string, params: unknown[]): Promise<number> {
  const res = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${table} WHERE ${where}`,
    params,
  )
  return Number(res.rows[0].n)
}

/** Deletes every catalog row whose artist carries `sfx`; versions cascade. */
async function cleanCatalog(sfx: string): Promise<void> {
  await query('DELETE FROM songs WHERE artist LIKE $1', [`%${sfx}%`])
  await query('DELETE FROM albums WHERE artist LIKE $1 OR name LIKE $1', [`%${sfx}%`])
}

describe.skipIf(!RUN_DB_TESTS)('the catalog version schema (RH-122)', () => {
  const sfx = token()

  afterAll(async () => {
    await cleanCatalog(sfx)
  })

  // -------------------------------------------------------------------------
  // ER2 — the album identity key has the artist in it.
  // -------------------------------------------------------------------------
  it('admits two same-named albums by different artists, and refuses a case variant (ER2)', async () => {
    const name = `Greatest Hits ${sfx}`

    const queen = await query<{ id: string }>(
      'INSERT INTO albums (artist, name) VALUES ($1, $2) RETURNING id',
      [`Queen ${sfx}`, name],
    )
    const jackson = await query<{ id: string }>(
      'INSERT INTO albums (artist, name) VALUES ($1, $2) RETURNING id',
      [`Michael Jackson ${sfx}`, name],
    )

    // Both persist: keying on the name alone would have merged them into one
    // row with one cover and one release date, irreversibly.
    expect(queen.rows[0].id).toBeTruthy()
    expect(jackson.rows[0].id).toBeTruthy()
    const both = await query<{ n: string }>(
      'SELECT count(*)::text AS n FROM albums WHERE name = $1',
      [name],
    )
    expect(both.rows[0].n).toBe('2')

    // The same pair in a different case is the same album.
    await expect(
      query('INSERT INTO albums (artist, name) VALUES ($1, $2)', [
        `queen ${sfx}`.toLowerCase(),
        name.toLowerCase(),
      ]),
    ).rejects.toThrow(/duplicate key value|unique/i)
  })

  it('carries an artist column and the case-folded unique index on (artist, name) (ER2)', async () => {
    const columns = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'albums' ORDER BY column_name`,
    )
    const names = columns.rows.map((r) => r.column_name)
    for (const column of ['id', 'artist', 'name', 'album_type', 'cover_url', 'release_date']) {
      expect(names).toContain(column)
    }

    const index = await query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'uq_albums_artist_name'`,
    )
    expect(index.rows[0].indexdef).toContain('CREATE UNIQUE INDEX')
    expect(index.rows[0].indexdef).toContain('lower(artist), lower(name)')
  })

  it('constrains album_type to the three types Spotify reports', async () => {
    await expect(
      query('INSERT INTO albums (artist, name, album_type) VALUES ($1, $2, $3)', [
        `Bad Type ${sfx}`,
        `Bad Type ${sfx}`,
        'ep',
      ]),
    ).rejects.toThrow(/album_type/i)
  })

  // -------------------------------------------------------------------------
  // ER3 — the version identity key is NULLS NOT DISTINCT.
  // -------------------------------------------------------------------------
  describe('the version identity key (ER3)', () => {
    let songId: string
    let albumId: string

    beforeAll(async () => {
      const song = await query<{ id: string }>(
        'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
        [`Version Song ${sfx}`, `Version Artist ${sfx}`],
      )
      songId = song.rows[0].id
      const album = await query<{ id: string }>(
        'INSERT INTO albums (artist, name) VALUES ($1, $2) RETURNING id',
        [`Version Artist ${sfx}`, `Version Album ${sfx}`],
      )
      albumId = album.rows[0].id
    })

    it('is declared NULLS NOT DISTINCT in the catalog', async () => {
      const index = await query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'uq_song_versions_identity'`,
      )
      expect(index.rows[0].indexdef).toContain('CREATE UNIQUE INDEX')
      expect(index.rows[0].indexdef).toContain('(song_id, album_id, label)')
      expect(index.rows[0].indexdef).toContain('NULLS NOT DISTINCT')
    })

    it('refuses a second (song_id, album_id, null) row', async () => {
      await query('INSERT INTO song_versions (song_id, album_id, label) VALUES ($1, $2, NULL)', [
        songId,
        albumId,
      ])

      // A plain unique would treat the two nulls as distinct and insert both.
      await expect(
        query('INSERT INTO song_versions (song_id, album_id, label) VALUES ($1, $2, NULL)', [
          songId,
          albumId,
        ]),
      ).rejects.toThrow(/duplicate key value|unique/i)
    })

    it('accepts a row with a null album_id — a recording of an unknown release', async () => {
      const inserted = await query<{ id: string }>(
        'INSERT INTO song_versions (song_id, album_id, label) VALUES ($1, NULL, $2) RETURNING id',
        [songId, `Live ${sfx}`],
      )
      expect(inserted.rows[0].id).toBeTruthy()

      const nullable = await query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'song_versions' AND column_name = 'album_id'`,
      )
      expect(nullable.rows[0].is_nullable).toBe('YES')
    })

    it('carries every column the restructured catalog needs (ER1)', async () => {
      const columns = await query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'song_versions' ORDER BY column_name`,
      )
      const names = columns.rows.map((r) => r.column_name)
      for (const column of [
        'id',
        'song_id',
        'album_id',
        'label',
        'duration_seconds',
        'key',
        'tuning',
        'lyrics',
        'map',
      ]) {
        expect(names).toContain(column)
      }
    })
  })

  // -------------------------------------------------------------------------
  // ER4 — the songs key survives the drop/recreate round trip unchanged.
  // -------------------------------------------------------------------------
  describe("RH-95's artist+title unique index, after the round trip (ER4)", () => {
    it('is still there, under the same name and on the same expressions', async () => {
      const index = await query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'uq_songs_artist_title'`,
      )
      expect(index.rows).toHaveLength(1)
      expect(index.rows[0].indexdef).toContain('CREATE UNIQUE INDEX')
      expect(index.rows[0].indexdef).toMatch(/lower\(btrim\(artist\)\), lower\(btrim\(title\)\)/)
    })

    it('has no unique index on songs that mentions album', async () => {
      const uniques = await query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'songs'
            AND indexdef LIKE 'CREATE UNIQUE INDEX%'`,
      )
      const mentioningAlbum = uniques.rows.filter((r) => /album/i.test(r.indexdef))
      expect(mentioningAlbum.map((r) => r.indexname)).toEqual([])
    })

    it('still refuses two rows for one artist that differ only by album', async () => {
      const title = `Album Key Song ${sfx}`
      const artist = `Album Key Artist ${sfx}`

      const first = await query<{ id: string }>(
        'INSERT INTO songs (title, artist, album) VALUES ($1, $2, $3) RETURNING id',
        [title, artist, 'Album One'],
      )
      expect(first.rows[0].id).toBeTruthy()

      await expect(
        query('INSERT INTO songs (title, artist, album) VALUES ($1, $2, $3)', [
          title,
          artist,
          'Album Two',
        ]),
      ).rejects.toThrow(/duplicate key value|unique/i)
    })
  })

  // -------------------------------------------------------------------------
  // ER5 / ER14 — the two new `songs` columns, and `repertoire` untouched.
  // -------------------------------------------------------------------------
  it('gives songs nullable lyrics and map columns (ER5)', async () => {
    const columns = await query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'songs'
          AND column_name IN ('lyrics', 'map') ORDER BY column_name`,
    )
    expect(columns.rows).toEqual([
      { column_name: 'lyrics', is_nullable: 'YES' },
      { column_name: 'map', is_nullable: 'YES' },
    ])
  })

  describe('repertoire is untouched by this task (ER14)', () => {
    it('still carries song_id referencing songs, and no version_id', async () => {
      const columns = await query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'repertoire' ORDER BY column_name`,
      )
      const names = columns.rows.map((r) => r.column_name)

      // The column set as it stood before this task, exactly.
      expect(names).toEqual([
        'band_id',
        'id',
        'last_practiced',
        'lyrics',
        'personal_key',
        'song_id',
        'status',
        'tags',
        'user_id',
      ])
      expect(names).not.toContain('version_id')

      const fk = await query<{ referenced: string }>(
        `SELECT confrelid::regclass::text AS referenced FROM pg_constraint
          WHERE conname = 'repertoire_song_id_fkey'`,
      )
      expect(fk.rows.map((r) => r.referenced)).toEqual(['songs'])
    })
  })

  // -------------------------------------------------------------------------
  // The SQL split and the TypeScript split are one rule in two engines.
  // -------------------------------------------------------------------------
  it('splits titles in SQL exactly as src/lib/songTitle.ts does (ER7)', async () => {
    const titles = [
      'Still Of The Night - 2018 Remaster',
      'Smooth Criminal - Live at Wembley',
      'Hotel California',
      'Song - ',
      ' - Live',
      'Song - Live - 2012 Remaster',
      '   Black Dog   -   2007 Remaster   ',
      "Sweet Child O' Mine (2022 Remastered)",
      'Jack-in-the-box',
      '2018 Remaster',
      '-',
    ]

    const res = await query<{ raw: string; head: string; label: string | null }>(
      `SELECT raw, song_title_head(raw) AS head, song_title_label(raw) AS label
         FROM unnest($1::text[]) AS raw`,
      [titles],
    )

    const bySql = new Map(res.rows.map((r) => [r.raw, { title: r.head, label: r.label }]))
    for (const raw of titles) {
      expect(bySql.get(raw), `SQL returned nothing for ${JSON.stringify(raw)}`).toEqual(
        splitSongTitle(raw),
      )
    }
  })
})

// ---------------------------------------------------------------------------
// ER8 / ER9 / ER10 — the write paths, counted with SELECT count(*).
// ---------------------------------------------------------------------------
describe.skipIf(!RUN_DB_TESTS)('the catalog write paths (RH-122)', () => {
  const sfx = token()
  const artist = `Write Artist ${sfx}`
  let userId: string
  let otherUserId: string

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh122-write-${sfx}@test.local` })
    otherUserId = await createTestUser({ email: `rh122-write2-${sfx}@test.local` })
  })

  afterAll(async () => {
    if (userId) await deleteTestUser(userId)
    if (otherUserId) await deleteTestUser(otherUserId)
    await cleanCatalog(sfx)
  })

  it('resolves a suffixed manual entry onto the existing row and records its label (ER8)', async () => {
    const plain = `Song X ${sfx}`

    await createAndAddSong({ userId }, { title: plain, artist })
    // A different owner, so the repertoire insert is not the thing that refuses.
    // No 23505 may surface here: the resolver matches on the *split* title, so
    // the suffixed entry finds the row the plain one created.
    await createAndAddSong({ userId: otherUserId }, { title: `${plain} - 2011 Remaster`, artist })

    expect(await countOf('songs', 'artist = $1', [artist])).toBe(1)

    const versions = await query<{ label: string | null }>(
      `SELECT v.label FROM song_versions v
         JOIN songs s ON s.id = v.song_id
        WHERE s.artist = $1 ORDER BY v.label NULLS FIRST`,
      [artist],
    )
    expect(versions.rows.map((r) => r.label)).toEqual([null, '2011 Remaster'])

    // The suffix never reaches the title the catalog stores (ER9).
    const stored = await query<{ title: string }>('SELECT title FROM songs WHERE artist = $1', [
      artist,
    ])
    expect(stored.rows[0].title).toBe(plain)
    expect(stored.rows[0].title).not.toContain(' - ')
  })

  it('leaves one album, one song and one version after importing a track twice (ER10)', async () => {
    const importArtist = `Import Artist ${sfx}`
    const album = `Import Album ${sfx}`
    const track = spotifyTrack({
      title: `Imported Song ${sfx} - 2012 Remaster`,
      artist: importArtist,
      album,
      albumArt: 'http://art',
      durationSeconds: 231,
    })

    const firstId = await findOrCreateSong(track)
    const secondId = await findOrCreateSong(track)

    expect(secondId).toBe(firstId)
    expect(await countOf('songs', 'artist = $1', [importArtist])).toBe(1)
    expect(await countOf('albums', 'artist = $1', [importArtist])).toBe(1)
    expect(await countOf('song_versions', 'song_id = $1', [firstId])).toBe(1)

    // ER9 — the halves land in the two different keys.
    const row = await query<{ title: string; label: string | null; name: string }>(
      `SELECT s.title, v.label, a.name
         FROM songs s
         JOIN song_versions v ON v.song_id = s.id
         JOIN albums a ON a.id = v.album_id
        WHERE s.id = $1`,
      [firstId],
    )
    expect(row.rows[0].title).toBe(`Imported Song ${sfx}`)
    expect(row.rows[0].label).toBe('2012 Remaster')
    expect(row.rows[0].name).toBe(album)
  })

  it('keeps two albums for one album name credited to two artists (ER10)', async () => {
    const album = `Shared Name ${sfx}`

    await findOrCreateSong(
      spotifyTrack({
        spotifyTrackId: 'q1',
        spotifyUrl: 'https://open.spotify.com/track/q1',
        title: `Queen Song ${sfx}`,
        artist: `Queen ${sfx}`,
        album,
      }),
    )
    await findOrCreateSong(
      spotifyTrack({
        spotifyTrackId: 'j1',
        spotifyUrl: 'https://open.spotify.com/track/j1',
        title: `Jackson Song ${sfx}`,
        artist: `Jackson ${sfx}`,
        album,
      }),
    )

    expect(await countOf('albums', 'name = $1', [album])).toBe(2)
  })

  it('stores the album name raw — the edition is a release of its own (ER6)', async () => {
    const album = `Nevermind ${sfx} (30th Anniversary Super Deluxe Edition)`

    await findOrCreateSong(
      spotifyTrack({
        spotifyTrackId: 'n1',
        spotifyUrl: 'https://open.spotify.com/track/n1',
        title: `Deluxe Song ${sfx}`,
        artist: `Deluxe Artist ${sfx}`,
        album,
      }),
    )

    const stored = await query<{ name: string }>('SELECT name FROM albums WHERE artist = $1', [
      `Deluxe Artist ${sfx}`,
    ])
    expect(stored.rows.map((r) => r.name)).toEqual([album])
  })

  it('never persists a songs title that still carries the separator (ER9)', async () => {
    const leftovers = await query<{ title: string }>(
      "SELECT title FROM songs WHERE artist LIKE $1 AND title LIKE '% - %'",
      [`%${sfx}%`],
    )
    expect(leftovers.rows.map((r) => r.title)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ER10 — the import of one track is atomic with the catalog resolution.
//
// The counting tests above prove the upserts are idempotent; none of them can
// fail halfway, so none of them pinned atomicity. This one does, with the fault
// injected *in Postgres* the way `transactionAtomicity.db.test.ts` does it: a
// trigger scoped to one fixture label raises at the version insert, which is the
// last of the three statements and the one whose failure would otherwise leave
// the first two committed on their own pooled connections.
// ---------------------------------------------------------------------------
describe.skipIf(!RUN_DB_TESTS)('the import of one track is atomic (RH-122)', () => {
  const sfx = token()
  const artist = `Atomic Artist ${sfx}`
  const album = `Atomic Album ${sfx}`
  const label = `Atomic Label ${sfx}`
  const trigger = `rh122_version_fault_${sfx}`
  const FAILURE = 'RH-122 injected version failure'

  beforeAll(async () => {
    await query(
      `CREATE OR REPLACE FUNCTION rh122_raise() RETURNS trigger AS $fn$
       BEGIN RAISE EXCEPTION '${FAILURE}'; END;
       $fn$ LANGUAGE plpgsql`,
    )
    // Scoped to this suite's own label: vitest runs files in parallel workers
    // and `song_versions` is shared with every other `*.db.test.ts`.
    await query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON song_versions
       FOR EACH ROW WHEN (NEW.label = '${label}') EXECUTE FUNCTION rh122_raise()`,
    )
  })

  afterAll(async () => {
    await query(`DROP TRIGGER IF EXISTS ${trigger} ON song_versions`)
    await cleanCatalog(sfx)
  })

  it('leaves no songs row and no albums row when the version insert fails (ER10)', async () => {
    const track = spotifyTrack({
      spotifyTrackId: 'atomic-1',
      spotifyUrl: 'https://open.spotify.com/track/atomic-1',
      title: `Atomic Song ${sfx} - ${label}`,
      artist,
      album,
      albumArt: 'http://art',
      durationSeconds: 210,
    })

    await expect(findOrCreateSong(track)).rejects.toThrow(FAILURE)

    // Each of these would survive without the transaction: the `songs` row is
    // written by the resolver and the `albums` row by the upsert that precedes
    // the failing version insert, and on the pool every statement commits on a
    // connection of its own. The catalog has no delete path to clean up either.
    expect(await countOf('songs', 'artist = $1', [artist])).toBe(0)
    expect(await countOf('albums', 'artist = $1', [artist])).toBe(0)
    expect(await countOf('song_versions', 'label = $1', [label])).toBe(0)
  })
})
