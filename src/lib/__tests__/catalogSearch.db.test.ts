/**
 * RH-113 — catalog search against a real Postgres: the trigram indexes, the
 * relevance order, literal `%`/`_` and the short-query path.
 *
 * It skips visibly without `RUN_DB_TESTS`.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { query, withTransaction } from '@/lib/db'
import { searchSongs } from '@/lib/songs'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('catalog search (RH-113)', () => {
  const sfx = randomUUID().replace(/-/g, '').slice(0, 10)
  const artist = `Srch Artist ${sfx}`

  async function insertSong(title: string, songArtist = artist): Promise<string> {
    const res = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [title, songArtist],
    )
    return res.rows[0].id
  }

  afterAll(async () => {
    await query('DELETE FROM songs WHERE artist LIKE $1 OR title LIKE $1', [`%${sfx}%`])
  })

  it('ER1: pg_indexes lists GIN gin_trgm_ops indexes on songs.title and songs.artist', async () => {
    const res = await query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'songs' AND indexdef ILIKE '%gin_trgm_ops%'`,
    )
    const defs = res.rows.map((r) => r.indexdef)
    expect(defs.some((d) => /USING gin \(title gin_trgm_ops\)/.test(d))).toBe(true)
    expect(defs.some((d) => /USING gin \(artist gin_trgm_ops\)/.test(d))).toBe(true)
  })

  it('ER2: the substring predicate plans onto a trigram index', async () => {
    const plan = await withTransaction(async (client) => {
      await client.query('SET LOCAL enable_seqscan = off')
      const res = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM songs WHERE title ILIKE $1 OR artist ILIKE $1`,
        [`%love${sfx}%`],
      )
      return res.rows.map((r) => r['QUERY PLAN']).join('\n')
    })
    expect(plan).toMatch(/Bitmap Index Scan on \w+/)
    expect(plan).not.toMatch(/Seq Scan/)
  })

  it('ER3: ranks exact title, then title prefix, then the rest; artist-only still returned', async () => {
    const word = `lov${sfx}`
    const glove = await insertSong(`Glove ${word} Story`)
    const supreme = await insertSong(`A ${word} Supreme`)
    const prefix = await insertSong(`${word} Me Tender`)
    const exact = await insertSong(word)
    const byArtist = await insertSong('Unrelated', `${word} Band`)

    const rows = await searchSongs(word)
    const ids = rows.map((r) => r.id)

    expect(ids[0]).toBe(exact)
    expect(ids[1]).toBe(prefix)
    expect(ids).toEqual(expect.arrayContaining([glove, supreme, byArtist]))
    expect(ids).toHaveLength(5)
  })

  it('ER4: % and _ match literally', async () => {
    const pct = await insertSong(`Fifty 50% ${sfx}`)
    await insertSong(`Fifty 500 ${sfx}`)
    const under = await insertSong(`a_b ${sfx}`)
    await insertSong(`axb ${sfx}`)

    expect((await searchSongs(`50% ${sfx}`)).map((r) => r.id)).toEqual([pct])
    expect((await searchSongs(`a_b ${sfx}`)).map((r) => r.id)).toEqual([under])
  })

  it('ER5: one- and two-character queries return correct matches', async () => {
    const song = await insertSong(`Zq ${sfx}`)
    const one = (await searchSongs('Z')).map((r) => r.id)
    expect(one).toContain(song)
    const two = await searchSongs('zq')
    expect(two.map((r) => r.id)).toContain(song)
    expect(two.every((r) => /zq/i.test(r.title) || /zq/i.test(r.artist))).toBe(true)
  })

  it('ER8: each result keeps version_id and versions', async () => {
    const id = await insertSong(`Shape ${sfx}`)
    const rows = await searchSongs(`Shape ${sfx}`)
    const row = rows.find((r) => r.id === id)
    expect(row).toBeDefined()
    expect(row).toHaveProperty('version_id')
    expect(Array.isArray(row!.versions)).toBe(true)
  })

  it('ER7: returns at most 20 songs', async () => {
    const title = `Cap ${sfx}`
    for (let n = 0; n < 22; n += 1) await insertSong(`${title} ${n}`)
    expect(await searchSongs(title)).toHaveLength(20)
  })
})
