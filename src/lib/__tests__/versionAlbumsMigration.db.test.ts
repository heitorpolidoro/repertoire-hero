/**
 * RH-120 — `migrations/0029_version_albums.sql`, executed over a legacy-shaped
 * fixture.
 *
 * CI's fresh database holds no pre-migration row, so the backfill and the
 * collapse can only be observed by replaying the file. The replay happens in a
 * **throwaway schema** first on the transaction's `search_path` (the pattern of
 * `catalogVersionsMigration.db.test.ts`), so nothing in `public` is touched, and
 * the transaction is always rolled back by a thrown sentinel.
 *
 * The schema holds only what the file reads or writes, at its pre-0029 shape.
 * Foreign keys to tables the replay does not need (`profiles`, `bands`,
 * `playlists`) are omitted, as the other replay helpers do.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTransaction, type Queryable } from '@/lib/db'
import { migrationSqlBySuffix } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const ROLLBACK = 'RH-120 migration scenario rollback'

function token(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

const LEGACY_DDL = (schema: string) => `
  CREATE SCHEMA ${schema};
  CREATE TABLE ${schema}.songs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE ${schema}.albums (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      album_type   text,
      release_date date
  );
  CREATE TABLE ${schema}.song_versions (
      id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      song_id    uuid        NOT NULL REFERENCES ${schema}.songs(id) ON DELETE CASCADE,
      album_id   uuid        REFERENCES ${schema}.albums(id) ON DELETE SET NULL,
      label      text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_song_versions_identity UNIQUE NULLS NOT DISTINCT (song_id, album_id, label)
  );
  CREATE INDEX idx_song_versions_album_id ON ${schema}.song_versions (album_id);
  CREATE TABLE ${schema}.user_songs (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    uuid NOT NULL,
      version_id uuid NOT NULL REFERENCES ${schema}.song_versions(id) ON DELETE CASCADE,
      status     text NOT NULL DEFAULT 'unknown',
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_user_songs_user_version UNIQUE (user_id, version_id)
  );
  CREATE TABLE ${schema}.band_songs (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      band_id    uuid NOT NULL,
      version_id uuid NOT NULL REFERENCES ${schema}.song_versions(id) ON DELETE CASCADE,
      status     text NOT NULL DEFAULT 'unknown',
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_band_songs_band_version UNIQUE (band_id, version_id)
  );
  CREATE TABLE ${schema}.playlist_songs (
      id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
      playlist_id uuid    NOT NULL,
      version_id  uuid    NOT NULL REFERENCES ${schema}.song_versions(id) ON DELETE CASCADE,
      position    integer NOT NULL DEFAULT 0,
      CONSTRAINT uq_playlist_song_version UNIQUE (playlist_id, version_id),
      CONSTRAINT uq_playlist_song_position
          UNIQUE (playlist_id, position) DEFERRABLE INITIALLY IMMEDIATE
  );
`

async function one<T>(client: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  return (await client.query<T & object>(sql, params)).rows[0] as T
}

async function ids(client: Queryable, sql: string, params: unknown[] = []): Promise<string[]> {
  const res = await client.query<{ v: string }>(sql, params)
  return res.rows.map((r) => r.v)
}

interface Outcome {
  columns: string[]
  primaryKey: string[]
  songVersionIds: string[]
  survivorId: string
  survivorAlbums: string[]
  liveAlbums: string[]
  albumlessLinks: number
  heldByU1: string[]
  heldByU2: string[]
  heldByU3: Array<{ version_id: string; status: string }>
  heldByBand: string[]
  playlist: Array<{ version_id: string; position: number }>
  ledger: Array<{ source_table: string; loser: string; survivor: string; status: string | null }>
  identity: string
  duplicateCode: string | undefined
  albumA1: string
  albumA2: string
  v: Record<string, string>
}

describe.skipIf(!RUN_DB_TESTS)('migration 0029 over a split-recording fixture (RH-120)', () => {
  let out: Outcome

  beforeAll(async () => {
    const schema = `rh120_${token()}`
    const sql = migrationSqlBySuffix('_version_albums.sql')
    let captured: Outcome | undefined

    await withTransaction(async (client) => {
      await client.query(LEGACY_DDL(schema))
      await client.query(`SET LOCAL search_path = ${schema}, public`)

      const song = (await one<{ id: string }>(client, 'INSERT INTO songs DEFAULT VALUES RETURNING id')).id
      const otherSong = (await one<{ id: string }>(client, 'INSERT INTO songs DEFAULT VALUES RETURNING id')).id
      const a1 = (
        await one<{ id: string }>(
          client,
          "INSERT INTO albums (album_type, release_date) VALUES ('album', '2000-01-01') RETURNING id",
        )
      ).id
      const a2 = (
        await one<{ id: string }>(
          client,
          "INSERT INTO albums (album_type, release_date) VALUES ('compilation', '1999-01-01') RETURNING id",
        )
      ).id

      const version = async (songId: string, albumId: string | null, label: string | null, ageDays: number) =>
        (
          await one<{ id: string }>(
            client,
            `INSERT INTO song_versions (song_id, album_id, label, created_at)
             VALUES ($1, $2, $3, now() - ($4 || ' days')::interval) RETURNING id`,
            [songId, albumId, label, String(ageDays)],
          )
        ).id

      // The compilation row is OLDER, but the studio album wins on type.
      const v2 = await version(song, a2, null, 10)
      const v1 = await version(song, a1, null, 1)
      const vLive = await version(song, a1, 'Live', 5)
      const vNone = await version(otherSong, null, null, 1)

      const u1 = randomUUID()
      const u2 = randomUUID()
      const u3 = randomUUID()
      const band = randomUUID()
      const playlist = randomUUID()
      const hold = (table: 'user_songs' | 'band_songs', owner: string, versionId: string, status: string) =>
        client.query(
          `INSERT INTO ${table} (${table === 'user_songs' ? 'user_id' : 'band_id'}, version_id, status)
           VALUES ($1, $2, $3)`,
          [owner, versionId, status],
        )
      await hold('user_songs', u1, v1, 'learning')
      await hold('user_songs', u2, v2, 'mastered')
      await hold('user_songs', u3, v1, 'learning')
      await hold('user_songs', u3, v2, 'mastered')
      await hold('band_songs', band, v2, 'learning')
      for (const [versionId, position] of [
        [v1, 1],
        [v2, 2],
        [vLive, 3],
      ] as const) {
        await client.query(
          'INSERT INTO playlist_songs (playlist_id, version_id, position) VALUES ($1, $2, $3)',
          [playlist, versionId, position],
        )
      }

      await client.query(sql)

      const survivorAlbums = await ids(
        client,
        'SELECT album_id AS v FROM version_albums WHERE version_id = $1 ORDER BY album_id',
        [v1],
      )
      const snapshot: Omit<Outcome, 'duplicateCode'> = {
        columns: await ids(
          client,
          `SELECT column_name AS v FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'song_versions'`,
          [schema],
        ),
        primaryKey: await ids(
          client,
          `SELECT a.attname AS v
             FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY a.attname`,
          [`${schema}.version_albums`],
        ),
        songVersionIds: await ids(client, 'SELECT id AS v FROM song_versions WHERE song_id = $1', [song]),
        survivorId: v1,
        survivorAlbums,
        liveAlbums: await ids(client, 'SELECT album_id AS v FROM version_albums WHERE version_id = $1', [vLive]),
        albumlessLinks: Number(
          (await one<{ n: string }>(client, 'SELECT count(*)::text AS n FROM version_albums WHERE version_id = $1', [vNone])).n,
        ),
        heldByU1: await ids(client, 'SELECT version_id AS v FROM user_songs WHERE user_id = $1', [u1]),
        heldByU2: await ids(client, 'SELECT version_id AS v FROM user_songs WHERE user_id = $1', [u2]),
        heldByU3: (
          await client.query<{ version_id: string; status: string }>(
            'SELECT version_id, status FROM user_songs WHERE user_id = $1',
            [u3],
          )
        ).rows,
        heldByBand: await ids(client, 'SELECT version_id AS v FROM band_songs WHERE band_id = $1', [band]),
        playlist: (
          await client.query<{ version_id: string; position: number }>(
            'SELECT version_id, position FROM playlist_songs WHERE playlist_id = $1 ORDER BY position',
            [playlist],
          )
        ).rows,
        ledger: (
          await client.query<Outcome['ledger'][number]>(
            `SELECT source_table, loser_version_id AS loser, survivor_version_id AS survivor,
                    row_json->>'status' AS status
               FROM merged_version_rows ORDER BY source_table`,
          )
        ).rows,
        identity: (
          await one<{ def: string }>(
            client,
            `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
              WHERE conname = 'uq_song_versions_identity' AND conrelid = $1::regclass`,
            [`${schema}.song_versions`],
          )
        ).def,
        albumA1: a1,
        albumA2: a2,
        v: { v1, v2, vLive, vNone },
      }

      // Last, because a refused insert aborts the transaction; the scenario is
      // rolled back anyway.
      const duplicateCode = await client
        .query('INSERT INTO song_versions (song_id, label) VALUES ($1, NULL)', [song])
        .then(() => undefined)
        .catch((error: { code?: string }) => error.code)
      captured = { ...snapshot, duplicateCode }
      throw new Error(ROLLBACK)
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
    })

    if (!captured) throw new Error('the scenario produced no result')
    out = captured
  })

  it('drops song_versions.album_id and creates version_albums with a composite key', () => {
    expect(out.columns).not.toContain('album_id')
    expect(out.primaryKey).toEqual(['album_id', 'version_id'])
  })

  it('collapses the split recording into the studio-album version holding both albums', () => {
    expect(out.songVersionIds.sort()).toEqual([out.survivorId, out.v.vLive].sort())
    expect(out.survivorAlbums.sort()).toEqual([out.albumA1, out.albumA2].sort())
  })

  it('keeps a non-colliding version and its single link, and an album-less one with none', () => {
    expect(out.liveAlbums).toEqual([out.albumA1])
    expect(out.albumlessLinks).toBe(0)
  })

  it('re-points every owner at the survivor and keeps the single hold of the double holder', () => {
    expect(out.heldByU1).toEqual([out.survivorId])
    expect(out.heldByU2).toEqual([out.survivorId])
    expect(out.heldByBand).toEqual([out.survivorId])
    expect(out.heldByU3).toEqual([{ version_id: out.survivorId, status: 'learning' }])
  })

  it("records the displaced rows in merged_version_rows and closes the playlist's gap", () => {
    expect(out.ledger).toEqual([
      { source_table: 'playlist_songs', loser: out.v.v2, survivor: out.survivorId, status: null },
      { source_table: 'user_songs', loser: out.v.v2, survivor: out.survivorId, status: 'mastered' },
    ])
    expect(out.playlist).toEqual([
      { version_id: out.survivorId, position: 1 },
      { version_id: out.v.vLive, position: 2 },
    ])
  })

  it('makes (song_id, label) the identity, refusing a second unlabelled version with 23505', () => {
    expect(out.identity).toBe('UNIQUE NULLS NOT DISTINCT (song_id, label)')
    expect(out.duplicateCode).toBe('23505')
  })
})
