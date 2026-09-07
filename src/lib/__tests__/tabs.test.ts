/**
 * RH-45 — unit suite for `src/lib/tabs.ts`, the new owner of every
 * `repertoire_tabs` statement that used to sit in `src/app/actions/tabs.ts`.
 *
 * `@/lib/db` is mocked, so `assertRepertoireAccess` (the real one, imported by
 * the module under test) is driven through the first queued `query` result:
 * `ACCESS_GRANTED` or `ACCESS_DENIED`. The statement under test is therefore
 * always `query` call index 1.
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
} from '../tabs'
import { query } from '@/lib/db'
import type { Stroke } from '@/types/database'

const USER_ID = 'user-1'
const TAB_ID = 'tab-1'
const REPERTOIRE_ID = 'repertoire-1'
const TITLE = 'Verse chart'
const FILE_URL = 'https://blob.example/repertoire-tabs/chart.pdf'

const strokes: Stroke[] = [
  { id: 'stroke-1', color: '#ef4444', width: 0.01, points: [[0.1, 0.1], [0.2, 0.2]] },
]

/** The row `assertRepertoireAccess` reads when the caller is entitled. */
const ACCESS_GRANTED = {
  rowCount: 1,
  rows: [{ id: REPERTOIRE_ID, song_id: 'song-1', user_id: USER_ID, band_id: null }],
}

/** No row: neither the caller's own entry nor one of their bands'. */
const ACCESS_DENIED = { rowCount: 0, rows: [] }

const grant = () => vi.mocked(query).mockResolvedValueOnce(ACCESS_GRANTED as never)
const deny = () => vi.mocked(query).mockResolvedValueOnce(ACCESS_DENIED as never)

/** The statement under test — `assertRepertoireAccess` always runs first. */
const statement = () => vi.mocked(query).mock.calls[1]

/** One row per function, used by the ownership and L1 tables below. */
const FUNCTIONS: Array<{ label: string; run: () => Promise<unknown>; failure: string }> = [
  {
    label: 'createTab',
    run: () => createTab(REPERTOIRE_ID, USER_ID, TITLE, FILE_URL),
    failure: 'Failed to create tab: connection lost',
  },
  {
    label: 'getTabFileUrl',
    run: () => getTabFileUrl(TAB_ID, REPERTOIRE_ID, USER_ID),
    failure: 'Failed to read tab file url: connection lost',
  },
  {
    label: 'deleteTab',
    run: () => deleteTab(TAB_ID, REPERTOIRE_ID, USER_ID),
    failure: 'Failed to delete tab: connection lost',
  },
  {
    label: 'getTabAnnotations',
    run: () => getTabAnnotations(TAB_ID, REPERTOIRE_ID, USER_ID),
    failure: 'Failed to load annotations: connection lost',
  },
  {
    label: 'saveTabAnnotations',
    run: () => saveTabAnnotations(TAB_ID, REPERTOIRE_ID, USER_ID, 3, strokes),
    failure: 'Failed to save annotations: connection lost',
  },
  {
    label: 'listTabs',
    run: () => listTabs(REPERTOIRE_ID, USER_ID),
    failure: 'Failed to list tabs: connection lost',
  },
]

beforeEach(() => {
  vi.mocked(query).mockReset()
})

describe('every tab function asserts repertoire access first', () => {
  it.each(FUNCTIONS)('$label refuses a caller with no claim on the entry', async ({ run }) => {
    deny()

    await expect(run()).rejects.toThrow('Access denied: not allowed on this repertoire entry')

    // The refusal happened before the statement: only the access read ran.
    expect(vi.mocked(query).mock.calls).toHaveLength(1)
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([REPERTOIRE_ID, USER_ID])
  })

  it.each(FUNCTIONS)('$label wraps a database failure in the L1 prefix', async ({ run, failure }) => {
    grant().mockRejectedValueOnce(new Error('connection lost'))

    await expect(run()).rejects.toThrow(failure)
  })
})

describe('createTab', () => {
  it('inserts the row and returns it with its created_at rendered as text', async () => {
    const inserted = {
      id: TAB_ID,
      repertoire_id: REPERTOIRE_ID,
      title: TITLE,
      file_url: FILE_URL,
      created_at: '2026-09-07T09:00:00Z',
    }
    grant().mockResolvedValueOnce({ rowCount: 1, rows: [inserted] } as never)

    await expect(createTab(REPERTOIRE_ID, USER_ID, TITLE, FILE_URL)).resolves.toEqual(inserted)

    const [sql, params] = statement()
    expect(sql).toContain('INSERT INTO repertoire_tabs')
    expect(sql).toContain('created_at::text as created_at')
    expect(params).toEqual([REPERTOIRE_ID, TITLE, FILE_URL])
  })
})

describe('getTabFileUrl', () => {
  it('returns the stored blob url for a matching tab/repertoire pair', async () => {
    grant().mockResolvedValueOnce({ rowCount: 1, rows: [{ file_url: FILE_URL }] } as never)

    await expect(getTabFileUrl(TAB_ID, REPERTOIRE_ID, USER_ID)).resolves.toBe(FILE_URL)

    const [sql, params] = statement()
    expect(sql).toContain('SELECT file_url FROM repertoire_tabs')
    expect(params).toEqual([TAB_ID, REPERTOIRE_ID])
  })

  it('returns null (not an exception) when the pair matches no row', async () => {
    grant().mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)

    await expect(getTabFileUrl(TAB_ID, REPERTOIRE_ID, USER_ID)).resolves.toBeNull()
  })
})

describe('deleteTab', () => {
  it('deletes the row scoped to both the tab id and the repertoire id', async () => {
    grant().mockResolvedValueOnce({ rowCount: 1, rows: [] } as never)

    await expect(deleteTab(TAB_ID, REPERTOIRE_ID, USER_ID)).resolves.toBeUndefined()

    const [sql, params] = statement()
    expect(sql).toContain('DELETE FROM repertoire_tabs')
    expect(params).toEqual([TAB_ID, REPERTOIRE_ID])
  })
})

describe('getTabAnnotations', () => {
  it('returns the stored annotations object', async () => {
    const stored = { '1': strokes }
    grant().mockResolvedValueOnce({ rowCount: 1, rows: [{ annotations: stored }] } as never)

    await expect(getTabAnnotations(TAB_ID, REPERTOIRE_ID, USER_ID)).resolves.toEqual(stored)

    const [sql, params] = statement()
    expect(sql).toContain('SELECT annotations FROM repertoire_tabs')
    expect(params).toEqual([TAB_ID, REPERTOIRE_ID])
  })

  it('returns null when the pair matches no row', async () => {
    grant().mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)

    await expect(getTabAnnotations(TAB_ID, REPERTOIRE_ID, USER_ID)).resolves.toBeNull()
  })
})

describe('saveTabAnnotations', () => {
  it('writes only the requested page through jsonb_set and reports true', async () => {
    grant().mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TAB_ID }] } as never)

    await expect(saveTabAnnotations(TAB_ID, REPERTOIRE_ID, USER_ID, 3, strokes)).resolves.toBe(true)

    const [sql, params] = statement()
    expect(sql).toContain('UPDATE repertoire_tabs')
    expect(sql).toContain('jsonb_set')
    expect(sql).toContain('RETURNING id')
    expect(params).toEqual([TAB_ID, REPERTOIRE_ID, '{3}', JSON.stringify(strokes)])
  })

  it('reports false when the update matches no row, so the caller can say Tab not found', async () => {
    grant().mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)

    await expect(saveTabAnnotations(TAB_ID, REPERTOIRE_ID, USER_ID, 1, strokes)).resolves.toBe(false)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
  ])('refuses a %s page number verbatim, before reaching SQL', async (_label, pageNumber) => {
    grant()

    await expect(
      saveTabAnnotations(TAB_ID, REPERTOIRE_ID, USER_ID, pageNumber, strokes),
    ).rejects.toThrow('Invalid page number')

    // Access was still asserted; the jsonb_set statement never ran.
    expect(vi.mocked(query).mock.calls).toHaveLength(1)
  })
})

describe('listTabs', () => {
  it('returns the repertoire entry tabs newest first', async () => {
    const rows = [{ id: TAB_ID, repertoire_id: REPERTOIRE_ID, title: TITLE, file_url: FILE_URL }]
    grant().mockResolvedValueOnce({ rowCount: 1, rows } as never)

    await expect(listTabs(REPERTOIRE_ID, USER_ID)).resolves.toEqual(rows)

    const [sql, params] = statement()
    expect(sql).toContain('FROM repertoire_tabs')
    expect(sql).toContain('ORDER BY created_at DESC')
    expect(params).toEqual([REPERTOIRE_ID])
  })
})
