/**
 * RH-143 — `songs.links` and the forward bridge trigger are gone.
 *
 * Two halves. The live schema (already migrated through 0028 by the time any
 * `*.db.test.ts` runs) is asserted directly. The conservation claim - every
 * `song_links` row survives the file - needs the file replayed over rows, so it
 * runs 0019, 0020 and 0028 inside a throwaway `rh143_<token>` schema that is
 * first on the transaction's `search_path` and is always rolled back through a
 * sentinel throw (the recipe `songLinksMigration.db.test.ts` uses). Files are
 * resolved by suffix, never by four-digit prefix. No transaction-control
 * literal appears here.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { query, withTransaction } from '@/lib/db'
import { searchSongs } from '@/lib/songs'
import { legacyCatalogReplayDdl, migrationSqlBySuffix } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const ROLLBACK = 'RH-143 replay scenario rollback'
const REPO_ROOT = path.resolve(__dirname, '../../..')
const SEED_SQL = fs.readFileSync(path.join(REPO_ROOT, 'scripts/seed-catalog.sql'), 'utf8')

const HOTEL_CALIFORNIA_URLS = [
  'https://www.cifraclub.com.br/eagles/hotel-california/',
  'https://www.youtube.com/watch?v=BciS5grGs7Y',
]

interface LinkRow {
  url: string
  label: string
  provider: string
  position: number
}

async function readLinks(client: { query: typeof query }, title: string): Promise<LinkRow[]> {
  const res = await client.query<LinkRow>(
    `SELECT l.url, l.label, l.provider, l.position
       FROM song_links l JOIN songs s ON s.id = l.song_id
      WHERE s.title = $1
      ORDER BY l.position, l.created_at, l.id`,
    [title],
  )
  return res.rows
}

async function replayDrop(): Promise<{ before: LinkRow[]; after: LinkRow[]; objects: number }> {
  const schema = `rh143_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let result: { before: LinkRow[]; after: LinkRow[]; objects: number } | undefined

  await withTransaction(async (client) => {
    await client.query(legacyCatalogReplayDdl(schema))
    await client.query(`SET LOCAL search_path = ${schema}, public`)
    await client.query(migrationSqlBySuffix('_song_links.sql'))
    await client.query(migrationSqlBySuffix('_drop_song_links_reverse_bridge.sql'))
    await client.query('INSERT INTO songs (title, artist, links) VALUES ($1, $2, $3::jsonb)', [
      'kept',
      'RH-143 Artist',
      JSON.stringify([
        { label: 'Spotify', url: 'https://open.spotify.com/track/1' },
        { label: 'Tube', url: 'https://youtu.be/abc' },
      ]),
    ])
    const before = await readLinks(client, 'kept')
    await client.query(migrationSqlBySuffix('_drop_songs_links.sql'))
    const after = await readLinks(client, 'kept')
    const objects = await client.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM pg_trigger t
                 JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE t.tgname = 'mirror_song_links_on_songs_write' AND n.nspname = $1)
            + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE p.proname = 'mirror_song_links_from_column' AND n.nspname = $1) AS n`,
      [schema],
    )
    result = { before, after, objects: Number(objects.rows[0].n) }
    throw new Error(ROLLBACK)
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
  })

  if (!result) throw new Error('the replay produced no result')
  return result
}

describe.skipIf(!RUN_DB_TESTS)('dropping songs.links (RH-143)', () => {
  it('ER1: songs has no links column', async () => {
    const res = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'songs' AND column_name = 'links'`,
    )
    expect(res.rows[0].n).toBe('0')
  })

  it('ER2: neither the forward trigger nor its function exists', async () => {
    const trg = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgname = 'mirror_song_links_on_songs_write' AND n.nspname = 'public'`,
    )
    const fn = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'mirror_song_links_from_column' AND n.nspname = 'public'`,
    )
    expect([trg.rows[0].n, fn.rows[0].n]).toEqual(['0', '0'])
  })

  it('ER1: a songs row can still be inserted without links', async () => {
    await withTransaction(async (client) => {
      const res = await client.query<{ id: string }>(
        "INSERT INTO songs (title, artist) VALUES ('RH-143 no links', 'RH-143 Artist') RETURNING id",
        [],
      )
      expect(res.rows).toHaveLength(1)
      throw new Error(ROLLBACK)
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
    })
  })

  it('ER3: song_links rows are unchanged across the migration file', async () => {
    const { before, after, objects } = await replayDrop()
    expect(before.map((r) => r.url)).toEqual([
      'https://open.spotify.com/track/1',
      'https://youtu.be/abc',
    ])
    expect(after).toEqual(before)
    expect(objects).toBe(0)
  })

  it('ER4: searchSongs rows carry no links key', async () => {
    const marker = `RH143 search ${randomUUID().slice(0, 8)}`
    await query("INSERT INTO songs (title, artist) VALUES ($1, 'RH-143 Artist')", [marker])
    try {
      const rows = await searchSongs(marker)
      expect(rows).toHaveLength(1)
      expect('links' in rows[0]).toBe(false)
    } finally {
      await query('DELETE FROM songs WHERE title = $1', [marker])
    }
  })

  it('ER5: the seed applies twice and leaves song_links in array order', async () => {
    const seen: string[][] = []
    await withTransaction(async (client) => {
      for (let run = 0; run < 2; run++) {
        await client.query(SEED_SQL)
        const rows = await readLinks(client, 'Hotel California')
        seen.push(rows.map((r) => r.url))
        expect(rows.map((r) => r.position)).toEqual([1, 2])
      }
      const total = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM song_links l JOIN songs s ON s.id = l.song_id
          WHERE s.artist IN ('Eagles', 'Tom Jobim')`,
        [],
      )
      expect(Number(total.rows[0].n)).toBeGreaterThanOrEqual(6)
      throw new Error(ROLLBACK)
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
    })
    expect(seen).toEqual([HOTEL_CALIFORNIA_URLS, HOTEL_CALIFORNIA_URLS])
  })
})
