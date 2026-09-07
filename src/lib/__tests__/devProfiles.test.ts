/**
 * RH-45 — `src/lib/devProfiles.ts` plus the route handler that now delegates to
 * it. Before this task `/api/dev/profiles` opened its own `pg` client, ignoring
 * the shared pool (and the `BETTER_AUTH_DATABASE_URL` fallback `src/lib/db.ts`
 * implements); the payload shape the login page consumes must not change.
 *
 * `@/lib/devProfiles` is partially mocked: `listDevProfiles` is a spy wrapping
 * the real implementation, so the unit cases below exercise the real SQL
 * mapping against a mocked `@/lib/db`, while the route cases can stub the
 * return value and prove the handler only delegates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  pool: { query: vi.fn() },
}))

vi.mock('@/lib/devProfiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../devProfiles')>()
  return { ...actual, listDevProfiles: vi.fn(actual.listDevProfiles) }
})

import { listDevProfiles } from '@/lib/devProfiles'
import { query } from '@/lib/db'
import { GET } from '@/app/api/dev/profiles/route'

const ROW = { id: 'u1', email: 'a@example.com', name: 'Ann' }
const MAPPED = { id: 'u1', email: 'a@example.com', full_name: 'Ann' }

beforeEach(() => {
  vi.mocked(query).mockReset()
  vi.mocked(listDevProfiles).mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('listDevProfiles', () => {
  it('reads the Better Auth "user" table through the shared pool and maps name to full_name', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [ROW] } as never)

    await expect(listDevProfiles()).resolves.toEqual([MAPPED])

    const [sql, params] = vi.mocked(query).mock.calls[0]
    expect(sql).toContain('SELECT id, email, name FROM "user" ORDER BY name')
    expect(params).toBeUndefined()
  })

  it('maps a user with no name to a null full_name', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'u2', email: 'b@example.com', name: null }],
    } as never)

    await expect(listDevProfiles()).resolves.toEqual([
      { id: 'u2', email: 'b@example.com', full_name: null },
    ])
  })

  it('returns an empty array for an empty table', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)

    await expect(listDevProfiles()).resolves.toEqual([])
  })

  it('wraps a database failure in the L1 prefix', async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error('connection lost'))

    await expect(listDevProfiles()).rejects.toThrow('Failed to list dev profiles: connection lost')
  })
})

describe('GET /api/dev/profiles', () => {
  it('returns 404 with { error: Not found } outside development, without reading anything', async () => {
    const response = await GET()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(listDevProfiles).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 200 with the { id, email, full_name } array the login page consumes', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(listDevProfiles).mockResolvedValueOnce([MAPPED])

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([MAPPED])
    expect(listDevProfiles).toHaveBeenCalledTimes(1)
  })

  it('answers the fixed R1 body, never the raw exception text, when the read fails', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(listDevProfiles).mockRejectedValueOnce(
      new Error('Failed to list dev profiles: connection lost'),
    )

    const response = await GET()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Unexpected error listing dev profiles',
      code: 500,
    })
  })
})
