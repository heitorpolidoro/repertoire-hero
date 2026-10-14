/**
 * RH-104 — the `song_files.content_type` column against a real Postgres.
 *
 * Two halves of one upload feature each hinge on this column and neither could
 * prove it alone: the ingest chooses the value, the viewer branches on it. The
 * mocked `tabs.test.ts` asserts the SQL text and the bound array, which a wrong
 * column position satisfies, so the value itself is checked here.
 *
 *  1. The replay: the migration that adds the column is executed against the
 *     real prior `song_files` (the migration that creates it, replayed as a
 *     prerequisite) in a throwaway schema inside a transaction that is always
 *     rolled back. Both files are resolved by name suffix, never by a numeric
 *     prefix, which moves whenever a sibling spec renumbers.
 *  2. The round trip: real `createTab` then `listTabs` against the migrated
 *     shared schema, for every content type the ingest can produce.
 *  3. The seam: the content type the real `prepareUploadBytes` produced is what
 *     `isImageTab` reads back out of `listTabs`.
 *
 * Every schema assertion is qualified by the replay schema. `public.song_files`
 * is already migrated, so an unqualified lookup is answered by `public` and
 * would pass with the migration deleted.
 *
 * Transactions are opened with `withTransaction` only (`transactionGuard.test.ts`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { query, withTransaction, type Queryable } from '@/lib/db'
import { createTab, listTabs } from '@/lib/tabs'
import { prepareUploadBytes } from '@/lib/fileIngest'
import { isImageTab } from '@/lib/tabRenderer'
import {
  createTestUser,
  deleteTestUser,
  legacyCatalogReplayDdl,
  migrationSqlBySuffix,
  ownerStubsDdl,
} from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const PREREQUISITE_SUFFIX = '_song_files.sql'
const SUBJECT_SUFFIX = '_add_song_file_content_type.sql'

const ROLLBACK = 'RH-104 content_type replay rollback'

interface ColumnInfo {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
}

/** The one catalog lookup in this file; the schema is always a bound parameter. */
async function columnsOf(client: Queryable, schema: string): Promise<ColumnInfo[]> {
  const res = await client.query<ColumnInfo>(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'song_files'`,
    [schema],
  )
  return res.rows
}

interface ReplayScenario {
  before: ColumnInfo[]
  after: ColumnInfo[]
  seededContentType: string
}

async function runReplay(): Promise<ReplayScenario> {
  const token = randomUUID().replace(/-/g, '').slice(0, 12)
  const schema = `rh104_${token}`
  let scenario: ReplayScenario | undefined

  await withTransaction(async (client) => {
    await client.query(legacyCatalogReplayDdl(schema))
    await client.query(ownerStubsDdl(schema))
    await client.query(`SET LOCAL search_path = ${schema}, public`)

    // The real prior shape of the table, off disk.
    await client.query(migrationSqlBySuffix(PREREQUISITE_SUFFIX))
    const before = await columnsOf(client, schema)

    // A row that exists before the ALTER, owned by a stub profile.
    const userId = randomUUID()
    await client.query('INSERT INTO profiles (id) VALUES ($1)', [userId])
    const song = await client.query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-104 Song ${token}`, `RH-104 Artist ${token}`],
    )
    const seeded = await client.query<{ id: string }>(
      'INSERT INTO song_files (user_id, song_id, title, file_url) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, song.rows[0].id, 'RH-104 Old Chart', 'https://blob.example/rh104/old.pdf'],
    )

    await client.query(migrationSqlBySuffix(SUBJECT_SUFFIX))

    const after = await columnsOf(client, schema)
    const read = await client.query<{ content_type: string }>(
      'SELECT content_type FROM song_files WHERE id = $1',
      [seeded.rows[0].id],
    )
    scenario = { before, after, seededContentType: read.rows[0].content_type }

    throw new Error(ROLLBACK)
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
  })

  if (!scenario) throw new Error('the replay produced no snapshot')
  return scenario
}

describe.skipIf(!RUN_DB_TESTS)('the song_files content_type column (RH-104)', () => {
  describe('the migration replayed in a throwaway schema', () => {
    let scenario: ReplayScenario

    beforeAll(async () => {
      scenario = await runReplay()
    }, 60_000)

    it('adds the column, which the prior shape lacked', () => {
      expect(scenario.before.map((c) => c.column_name)).not.toContain('content_type')
      expect(scenario.after.map((c) => c.column_name)).toContain('content_type')
    })

    it('makes it text NOT NULL DEFAULT application/pdf', () => {
      const column = scenario.after.find((c) => c.column_name === 'content_type')
      expect(column?.data_type).toBe('text')
      expect(column?.is_nullable).toBe('NO')
      expect(column?.column_default).toBe("'application/pdf'::text")
    })

    it('reads a row seeded before the ALTER back as application/pdf', () => {
      expect(scenario.seededContentType).toBe('application/pdf')
    })
  })

  describe('createTab and listTabs against the migrated schema', () => {
    const suffix = randomUUID().slice(0, 8)
    let userId: string
    let songId: string
    let rowsBefore: number

    async function countRows(): Promise<number> {
      const res = await query<{ n: string }>('SELECT count(*) AS n FROM song_files')
      return Number(res.rows[0].n)
    }

    beforeAll(async () => {
      rowsBefore = await countRows()
      userId = await createTestUser({ email: `rh104-${suffix}@example.test`, name: 'RH-104' })
      const song = await query<{ id: string }>(
        'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
        [`RH-104 Song ${suffix}`, `RH-104 Artist ${suffix}`],
      )
      songId = song.rows[0].id
    }, 30_000)

    afterAll(async () => {
      if (songId) await query('DELETE FROM songs WHERE id = $1', [songId])
      if (userId) await deleteTestUser(userId)
      expect(await countRows()).toBe(rowsBefore)
    })

    it.each(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])(
      'returns the exact stored content type for %s',
      async (contentType) => {
        const title = `RH-104 ${contentType}`
        await createTab({
          userId,
          songId,
          title,
          fileUrl: `https://blob.example/rh104/${suffix}/${encodeURIComponent(contentType)}`,
          contentType,
        })
        const listed = await listTabs(userId, songId)
        const row = listed.find((f) => f.title === title)
        expect(row?.content_type).toBe(contentType)
      },
    )

    it('reads application/pdf for a row inserted with no content_type at all', async () => {
      await query('INSERT INTO song_files (user_id, song_id, title, file_url) VALUES ($1, $2, $3, $4)', [
        userId,
        songId,
        'RH-104 default',
        `https://blob.example/rh104/${suffix}/default.pdf`,
      ])
      const row = (await listTabs(userId, songId)).find((f) => f.title === 'RH-104 default')
      expect(row?.content_type).toBe('application/pdf')
    })

    it('renders by what the ingest produced: a prepared JPEG is an image tab, a PDF is not', async () => {
      const jpeg = await sharp({
        create: { width: 120, height: 90, channels: 3, background: { r: 10, g: 120, b: 200 } },
      })
        .jpeg()
        .toBuffer()
      const prepared = await prepareUploadBytes(jpeg, 'image/jpeg')
      const pdf = await prepareUploadBytes(Buffer.from('%PDF-1.4 minimal', 'latin1'), 'application/pdf')

      await createTab({
        userId,
        songId,
        title: 'RH-104 ingest jpeg',
        fileUrl: `https://blob.example/rh104/${suffix}/ingest.jpg`,
        contentType: prepared.contentType,
      })
      await createTab({
        userId,
        songId,
        title: 'RH-104 ingest pdf',
        fileUrl: `https://blob.example/rh104/${suffix}/ingest.pdf`,
        contentType: pdf.contentType,
      })

      const listed = await listTabs(userId, songId)
      const jpegRow = listed.find((f) => f.title === 'RH-104 ingest jpeg')
      const pdfRow = listed.find((f) => f.title === 'RH-104 ingest pdf')
      expect(isImageTab(jpegRow?.content_type)).toBe(true)
      expect(isImageTab(pdfRow?.content_type)).toBe(false)
    })
  })
})
