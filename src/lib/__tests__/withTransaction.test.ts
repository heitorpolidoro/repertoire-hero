/**
 * RH-36 — `withTransaction` (src/lib/db.ts).
 *
 * No database: `pool.connect` is stubbed with `vi.spyOn`, so the helper drives a
 * fake client and every statement it issues is read back from the mock's
 * recorded arguments. The transaction-control keywords are only ever compared
 * against recorded calls here — they are never passed to a `query(` call, which
 * `transactionGuard.test.ts` forbids everywhere but `src/lib/db.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { PoolClient } from 'pg'
import { pool, withTransaction } from '@/lib/db'

const BEGIN = 'BEGIN'
const COMMIT = 'COMMIT'
const ROLLBACK = 'ROLLBACK'

interface FakeClient {
  query: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
}

/** `vi.spyOn` picks `Pool.connect`'s callback overload, hence the narrow cast. */
type ConnectSpy = { mockImplementation: (impl: () => Promise<PoolClient>) => void }

function fakeClient(queryImpl?: (text: string) => Promise<unknown>): FakeClient {
  const client: FakeClient = {
    query: vi.fn(queryImpl ?? (async () => ({ rows: [], rowCount: 0 }))),
    release: vi.fn(),
  }
  ;(vi.spyOn(pool, 'connect') as unknown as ConnectSpy).mockImplementation(() =>
    Promise.resolve(client as unknown as PoolClient),
  )
  return client
}

/** The statements the fake client recorded, in order. */
const statements = (client: FakeClient): string[] =>
  client.query.mock.calls.map((call) => String(call[0]))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('withTransaction', () => {
  it('commits and returns the callback result', async () => {
    const client = fakeClient()

    const result = await withTransaction(async (c) => {
      await c.query('SELECT 1')
      return 'the-result'
    })

    expect(result).toBe('the-result')
    expect(statements(client)).toEqual([BEGIN, 'SELECT 1', COMMIT])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('rolls back and rethrows when the callback throws', async () => {
    const client = fakeClient()
    const original = new Error('callback exploded')

    // `rejects.toBe` — the very error object, not a wrapper around it, so the
    // L1 log-then-wrap at each call site keeps producing the same message.
    await expect(
      withTransaction(async () => {
        throw original
      }),
    ).rejects.toBe(original)

    expect(statements(client)).toEqual([BEGIN, ROLLBACK])
  })

  it('releases the client when the callback throws', async () => {
    const client = fakeClient()

    await expect(
      withTransaction(async () => {
        throw new Error('callback exploded')
      }),
    ).rejects.toThrow('callback exploded')

    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('releases the client even when ROLLBACK itself fails', async () => {
    const client = fakeClient(async (text) => {
      if (text === ROLLBACK) throw new Error('connection already gone')
      return { rows: [], rowCount: 0 }
    })

    await expect(
      withTransaction(async () => {
        throw new Error('callback exploded')
      }),
    ).rejects.toThrow('callback exploded')

    expect(statements(client)).toEqual([BEGIN, ROLLBACK])
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
