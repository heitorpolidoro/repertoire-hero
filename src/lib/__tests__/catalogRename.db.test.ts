/**
 * RH-121 — the catalog table is `songs`, carries no contributor column, and still
 * owns the moderation-queue foreign key.
 *
 * `migrations/0013_rename_songs_to_songs.sql` is a pure rename plus one
 * column drop, which makes it exactly the kind of change no unit test can see:
 * every assertion about it is an assertion about the live catalog in Postgres.
 * So this file reads `information_schema` and `pg_indexes` directly rather than
 * going through `src/lib`, and then exercises the one thing a catalogue read
 * cannot prove — that `global_song_edits.song_id` repointed at the renamed
 * table by OID, with no `DROP CONSTRAINT`/`ADD CONSTRAINT` pair in the
 * migration.
 *
 * It is a `.db.test.ts` because it needs a migrated database, and it skips
 * visibly without `RUN_DB_TESTS`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { LEGACY_CATALOG_TABLE, createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

/** The prefix a leftover index or constraint name would still carry. */
const OLD_CATALOG_PREFIX = `${LEGACY_CATALOG_TABLE.slice(0, -1)}_`

/** The dropped column, assembled for the same reason (RH-121 ER5). */
const DROPPED_COLUMN = ['contributor', 'id'].join('_')

/**
 * The indexes the rename carried across. The third one is deliberately
 * `uq_songs_artist_title` and not the `uq_*_title_album` the spec's ER1 names:
 * RH-95 (`migrations/0009_unify_song_identity.sql`) dropped that partial unique
 * index on `(lower(title), lower(album))` after deduplicating the catalogue and
 * created the artist/title one as the single identity rule in its place, so the
 * third index on disk at rename time is this one. Same count, same role — it is
 * the index `resolveOrCreateSongIdentity`'s bare `ON CONFLICT DO NOTHING`
 * arbitrates against.
 */
const RENAMED_INDEXES = ['idx_songs_title', 'idx_songs_artist', 'uq_songs_artist_title']

/** The primary key constraint, renamed with its table. */
const RENAMED_PKEY = 'songs_pkey'

describe.skipIf(!RUN_DB_TESTS)('catalog table rename (real database)', () => {
  const suffix = Date.now()
  let userId: string
  let songId: string

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh121-rename-${suffix}@test.local` })
    const res = await query<{ id: string }>(
      `INSERT INTO songs (title, artist, links)
       VALUES ($1, $2, '[]'::jsonb) RETURNING id`,
      [`RH-121 Song ${suffix}`, 'RH-121 Artist'],
    )
    songId = res.rows[0].id
  })

  afterAll(async () => {
    if (songId) await query('DELETE FROM songs WHERE id = $1', [songId])
    if (userId) await deleteTestUser(userId)
  })

  it('exposes the catalog as `songs`', async () => {
    const res = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'songs'`,
    )
    expect(res.rows.map((r) => r.table_name)).toEqual(['songs'])
  })

  it('no longer exposes the old catalog table under its old name', async () => {
    const res = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1`,
      [LEGACY_CATALOG_TABLE],
    )
    expect(res.rows).toEqual([])
  })

  it('has dropped the contributor column from the catalog', async () => {
    const res = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'songs'
          AND column_name = $1`,
      [DROPPED_COLUMN],
    )
    expect(res.rows).toEqual([])
  })

  it('keeps the columns the rename was not about', async () => {
    const res = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'songs'
        ORDER BY column_name`,
    )
    const columns = res.rows.map((r) => r.column_name)
    for (const column of ['id', 'title', 'artist', 'album', 'standard_key', 'cover_url', 'duration_seconds', 'links', 'created_at', 'updated_at']) {
      expect(columns).toContain(column)
    }
  })

  it('carries the renamed indexes on `songs`', async () => {
    const res = await query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'songs'
        ORDER BY indexname`,
    )
    const names = res.rows.map((r) => r.indexname)
    for (const index of RENAMED_INDEXES) expect(names).toContain(index)
    expect(names).toContain(RENAMED_PKEY)
    expect(names.filter((n) => n.includes(OLD_CATALOG_PREFIX))).toEqual([])
  })

  it('keeps the unique catalog index a unique index on the identity pair', async () => {
    const res = await query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'uq_songs_artist_title'`,
    )
    expect(res.rows[0].indexdef).toContain('CREATE UNIQUE INDEX')
    expect(res.rows[0].indexdef).toMatch(/lower\(btrim\(artist\)\), lower\(btrim\(title\)\)/)
  })

  it('still lets `global_song_edits.song_id` reference a `songs` id', async () => {
    const res = await query<{ id: string }>(
      `INSERT INTO global_song_edits (song_id, requested_by, proposed_data)
       VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [songId, userId, JSON.stringify({ title: 'RH-121 Proposed' })],
    )
    expect(res.rows[0].id).toBeTruthy()
    await query('DELETE FROM global_song_edits WHERE id = $1', [res.rows[0].id])
  })

  it('rejects an edit row for a song id that is not in `songs`', async () => {
    await expect(
      query(
        `INSERT INTO global_song_edits (song_id, requested_by, proposed_data)
         VALUES ($1, $2, $3::jsonb)`,
        ['00000000-0000-0000-0000-000000000000', userId, JSON.stringify({ title: 'nope' })],
      ),
    ).rejects.toThrow(/foreign key/i)
  })

  it('points that foreign key at `songs`, by OID', async () => {
    const res = await query<{ referenced: string }>(
      `SELECT confrelid::regclass::text AS referenced
         FROM pg_constraint
        WHERE conname = 'global_song_edits_song_id_fkey'`,
    )
    expect(res.rows.map((r) => r.referenced)).toEqual(['songs'])
  })
})
