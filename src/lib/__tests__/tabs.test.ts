/**
 * Unit suite for `src/lib/tabs.ts`, the owner of every `song_files` statement.
 *
 * RH-123 re-keyed the module from `repertoire_id` onto `(user_id, song_id)` and
 * deleted the `assertRepertoireAccess` call that used to precede every
 * statement. Authorization is now `AND user_id = $n` inside the statement
 * itself, so there is no longer a first "access read" to queue: the statement
 * under test is `query` call index 0, and the suite asserts the predicate is
 * carried in the SQL and in the params rather than in a separate round trip.
 *
 * `@/lib/db` is mocked; nothing here touches Postgres.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  pool: { query: vi.fn() },
}))

import {
  createTab,
  getTabFileUrl,
  deleteTab,
  getTabAnnotations,
  saveTabAnnotations,
  listTabs,
  recordAbandonedBlob,
} from '../tabs'
import { query } from '@/lib/db'
import type { Stroke } from '@/types/database'

const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'
const FILE_ID = 'file-1'
const SONG_ID = 'song-1'
const TITLE = 'Verse chart'
const FILE_URL = 'https://blob.example/song-files/chart.pdf'

const strokes: Stroke[] = [
  { id: 'stroke-1', color: '#ef4444', width: 0.01, points: [[0.1, 0.1], [0.2, 0.2]] },
]

const resolveOnce = (rows: unknown[]) =>
  vi.mocked(query).mockResolvedValueOnce({ rowCount: rows.length, rows } as never)

/** The statement under test; no access read precedes it any more. */
const statement = () => vi.mocked(query).mock.calls[0]

/** One row per function, used by the authorization and L1 tables below. */
const FUNCTIONS: Array<{
  label: string
  run: () => Promise<unknown>
  failure: string
  /** Where the caller's own id sits in the statement's parameter list. */
  userIdIndex: number
  /**
   * True when `user_id` is a `WHERE` predicate rather than an inserted column.
   * `createTab` is the one write that *establishes* ownership instead of
   * checking it, so it is the one function with no predicate to assert.
   */
  scoped: boolean
}> = [
  {
    label: 'createTab',
    run: () => createTab(USER_ID, SONG_ID, TITLE, FILE_URL),
    failure: 'Failed to create file: connection lost',
    userIdIndex: 0,
    scoped: false,
  },
  {
    label: 'getTabFileUrl',
    run: () => getTabFileUrl(FILE_ID, USER_ID),
    failure: 'Failed to read file url: connection lost',
    userIdIndex: 1,
    scoped: true,
  },
  {
    label: 'deleteTab',
    run: () => deleteTab(FILE_ID, USER_ID),
    failure: 'Failed to delete file: connection lost',
    userIdIndex: 1,
    scoped: true,
  },
  {
    label: 'getTabAnnotations',
    run: () => getTabAnnotations(FILE_ID, USER_ID),
    failure: 'Failed to load annotations: connection lost',
    userIdIndex: 1,
    scoped: true,
  },
  {
    label: 'saveTabAnnotations',
    run: () => saveTabAnnotations(FILE_ID, USER_ID, 3, strokes),
    failure: 'Failed to save annotations: connection lost',
    userIdIndex: 1,
    scoped: true,
  },
  {
    label: 'listTabs',
    run: () => listTabs(USER_ID, SONG_ID),
    failure: 'Failed to list files: connection lost',
    userIdIndex: 0,
    scoped: true,
  },
  {
    label: 'recordAbandonedBlob',
    run: () => recordAbandonedBlob(FILE_URL, 'why'),
    failure: 'Failed to record an abandoned blob: connection lost',
    userIdIndex: -1,
    scoped: false,
  },
]

beforeEach(() => {
  vi.mocked(query).mockReset()
})

describe('authorization is the row\'s own user_id, inside every statement', () => {
  it.each(FUNCTIONS.filter((fn) => fn.scoped))(
    '$label carries user_id in both the SQL and the params',
    async ({ run, userIdIndex }) => {
      resolveOnce([])

      await run().catch(() => {})

      const [sql, params] = statement()
      expect(sql).toContain('user_id = $')
      expect((params as unknown[])[userIdIndex]).toBe(USER_ID)
      // One round trip: no separate repertoire-access read precedes it.
      expect(vi.mocked(query).mock.calls).toHaveLength(1)
    },
  )

  it.each(FUNCTIONS)('$label wraps a database failure in the L1 prefix', async ({ run, failure }) => {
    vi.mocked(query).mockRejectedValueOnce(new Error('connection lost'))

    await expect(run()).rejects.toThrow(failure)
  })
})

describe('createTab', () => {
  it('inserts the row under (user_id, song_id) and returns it', async () => {
    const inserted = {
      id: FILE_ID,
      user_id: USER_ID,
      song_id: SONG_ID,
      title: TITLE,
      file_url: FILE_URL,
      created_at: '2026-09-07T09:00:00Z',
    }
    resolveOnce([inserted])

    await expect(createTab(USER_ID, SONG_ID, TITLE, FILE_URL)).resolves.toEqual(inserted)

    const [sql, params] = statement()
    expect(sql).toContain('INSERT INTO song_files')
    expect(sql).toContain('created_at::text as created_at')
    expect(params).toEqual([USER_ID, SONG_ID, TITLE, FILE_URL])
  })
})

describe('getTabFileUrl', () => {
  it('returns the stored blob url for the caller\'s own file', async () => {
    resolveOnce([{ file_url: FILE_URL }])

    await expect(getTabFileUrl(FILE_ID, USER_ID)).resolves.toBe(FILE_URL)

    const [sql, params] = statement()
    expect(sql).toContain('SELECT file_url FROM song_files')
    expect(params).toEqual([FILE_ID, USER_ID])
  })

  it('returns null (not an exception) for another user\'s file', async () => {
    resolveOnce([])

    await expect(getTabFileUrl(FILE_ID, OTHER_USER_ID)).resolves.toBeNull()
  })
})

describe('deleteTab', () => {
  it('deletes the row scoped to both the file id and the owner', async () => {
    resolveOnce([])

    await expect(deleteTab(FILE_ID, USER_ID)).resolves.toBeUndefined()

    const [sql, params] = statement()
    expect(sql).toContain('DELETE FROM song_files')
    expect(params).toEqual([FILE_ID, USER_ID])
  })
})

describe('getTabAnnotations', () => {
  it('returns the stored annotations object', async () => {
    const stored = { '1': strokes }
    resolveOnce([{ annotations: stored }])

    await expect(getTabAnnotations(FILE_ID, USER_ID)).resolves.toEqual(stored)

    const [sql, params] = statement()
    expect(sql).toContain('SELECT annotations FROM song_files')
    expect(params).toEqual([FILE_ID, USER_ID])
  })

  it('returns null when the pair matches no row', async () => {
    resolveOnce([])

    await expect(getTabAnnotations(FILE_ID, USER_ID)).resolves.toBeNull()
  })
})

describe('saveTabAnnotations', () => {
  it('writes only the requested page through jsonb_set and reports true', async () => {
    resolveOnce([{ id: FILE_ID }])

    await expect(saveTabAnnotations(FILE_ID, USER_ID, 3, strokes)).resolves.toBe(true)

    const [sql, params] = statement()
    expect(sql).toContain('UPDATE song_files')
    expect(sql).toContain('jsonb_set')
    expect(sql).toContain('RETURNING id')
    expect(params).toEqual([FILE_ID, USER_ID, '{3}', JSON.stringify(strokes)])
  })

  it('reports false when the update matches no row, so the caller can say Tab not found', async () => {
    resolveOnce([])

    await expect(saveTabAnnotations(FILE_ID, USER_ID, 1, strokes)).resolves.toBe(false)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
  ])('refuses a %s page number verbatim, before reaching SQL', async (_label, pageNumber) => {
    await expect(saveTabAnnotations(FILE_ID, USER_ID, pageNumber, strokes)).rejects.toThrow(
      'Invalid page number',
    )

    expect(vi.mocked(query).mock.calls).toHaveLength(0)
  })
})

describe('listTabs', () => {
  it('returns the caller\'s own files for one song, newest first', async () => {
    const rows = [{ id: FILE_ID, user_id: USER_ID, song_id: SONG_ID, title: TITLE, file_url: FILE_URL }]
    resolveOnce(rows)

    await expect(listTabs(USER_ID, SONG_ID)).resolves.toEqual(rows)

    const [sql, params] = statement()
    expect(sql).toContain('FROM song_files')
    expect(sql).toContain('ORDER BY created_at DESC')
    expect(params).toEqual([USER_ID, SONG_ID])
  })
})

describe('recordAbandonedBlob', () => {
  it('appends to the ledger and absorbs a url already recorded', async () => {
    resolveOnce([])

    await expect(recordAbandonedBlob(FILE_URL, 'blob delete failed')).resolves.toBeUndefined()

    const [sql, params] = statement()
    expect(sql).toContain('INSERT INTO abandoned_blobs')
    expect(sql).toContain('ON CONFLICT (file_url) DO NOTHING')
    expect(params).toEqual([FILE_URL, 'blob delete failed'])
  })
})
