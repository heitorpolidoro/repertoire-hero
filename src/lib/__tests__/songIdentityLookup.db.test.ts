/**
 * RH-152 - `findSongByIdentity`, the read-only identity lookup behind the
 * dashboard's manual entry, against a real Postgres: it finds a song by the
 * same normalisation the write path uses and never inserts.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { findSongByIdentity } from '@/lib/songIdentity'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

/** A collision-free, dash-free token: a spaced dash is the title separator. */
const token = randomUUID().replace(/-/g, '').slice(0, 12)
const artist = `Lookup Artist ${token}`
const title = `Lookup Title ${token}`

const countSongs = async () => {
  const res = await query<{ n: string }>(`SELECT count(*)::text AS n FROM songs WHERE artist = $1`, [artist])
  return Number(res.rows[0].n)
}

describe.skipIf(!RUN_DB_TESTS)('findSongByIdentity (RH-152)', () => {
  afterAll(async () => {
    await query(`DELETE FROM songs WHERE artist = $1`, [artist])
  })

  it('returns null for an unknown identity and inserts nothing', async () => {
    expect(await findSongByIdentity(title, artist)).toBeNull()
    expect(await countSongs()).toBe(0)
  })

  it('finds an existing song regardless of case and surrounding whitespace', async () => {
    const inserted = await query<{ id: string }>(
      `INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id`,
      [title, artist],
    )

    const found = await findSongByIdentity(`  ${title.toUpperCase()} `, ` ${artist.toLowerCase()}  `)

    expect(found).toEqual({ id: inserted.rows[0].id, title, artist })
    expect(await countSongs()).toBe(1)
  })

  it('matches on the primary artist and the split title, like the write path', async () => {
    const found = await findSongByIdentity(`${title} - Remastered`, `${artist}, Some Guest`)

    expect(found?.title).toBe(title)
  })
})
