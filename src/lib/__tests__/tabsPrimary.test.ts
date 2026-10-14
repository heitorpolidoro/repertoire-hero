/**
 * RH-147 — the primary-file branches of `src/lib/tabs.ts` that a real database
 * cannot reach deterministically: the loser of two concurrent first uploads,
 * and the wrapped failures. The happy paths run against Postgres in
 * `authzTabs.db.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock, withTransactionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  withTransactionMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ query: queryMock, withTransaction: withTransactionMock }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

import { createTab, deleteTab, setTabPrimary } from '../tabs'

const PAYLOAD = {
  userId: 'u1',
  songId: 's1',
  title: 'Chart',
  fileUrl: 'https://blob.example/chart.pdf',
  contentType: 'application/pdf',
}

const slotTaken = Object.assign(new Error('duplicate key'), {
  code: '23505',
  constraint: 'uq_song_files_primary',
})

beforeEach(() => {
  queryMock.mockReset()
  withTransactionMock.mockReset()
})

describe('createTab', () => {
  it('claims the primary slot on the first attempt', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'f1', is_primary: true }] })

    await expect(createTab(PAYLOAD)).resolves.toMatchObject({ id: 'f1', is_primary: true })

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock.mock.calls[0][1].at(-1)).toBe(true)
  })

  it('retries as a non-primary file when a concurrent upload took the slot', async () => {
    queryMock
      .mockRejectedValueOnce(slotTaken)
      .mockResolvedValueOnce({ rows: [{ id: 'f2', is_primary: false }] })

    await expect(createTab(PAYLOAD)).resolves.toMatchObject({ id: 'f2', is_primary: false })

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryMock.mock.calls[1][1].at(-1)).toBe(false)
  })

  it('wraps any other failure and does not retry', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection lost'))

    await expect(createTab(PAYLOAD)).rejects.toThrow('Failed to create file: connection lost')

    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('does not treat a different unique violation as a taken slot', async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505', constraint: 'other' }))

    await expect(createTab(PAYLOAD)).rejects.toThrow('Failed to create file: dup')
  })
})

describe('the transactional writes', () => {
  it('wraps a failed delete', async () => {
    withTransactionMock.mockRejectedValueOnce(new Error('boom'))

    await expect(deleteTab('f1', 'u1')).rejects.toThrow('Failed to delete file: boom')
  })

  it('wraps a failed designation', async () => {
    withTransactionMock.mockRejectedValueOnce('not an error object')

    await expect(setTabPrimary('f1', 'u1')).rejects.toThrow(
      'Failed to set primary file: not an error object',
    )
  })

  it('promotes nothing when the delete matched no row', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) }
    withTransactionMock.mockImplementationOnce((fn: (c: typeof client) => Promise<unknown>) => fn(client))

    await deleteTab('f1', 'u1')

    expect(client.query).toHaveBeenCalledTimes(1)
  })
})
