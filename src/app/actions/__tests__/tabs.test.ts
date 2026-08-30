import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('@/lib/auth-session', () => ({
  getRequiredUserId: vi.fn(),
}))

import { getTabAnnotationsAction, saveTabAnnotationsAction } from '../tabs'
import { query } from '@/lib/db'
import { getRequiredUserId } from '@/lib/auth-session'
import type { Stroke } from '@/types/database'

const USER_ID = 'user-1'
const TAB_ID = 'tab-1'
const REPERTOIRE_ID = 'repertoire-1'

const sampleStrokes: Stroke[] = [
  { id: 'stroke-1', color: '#ef4444', width: 0.01, points: [[0.1, 0.1], [0.2, 0.2]] },
]

beforeEach(() => {
  vi.mocked(query).mockReset()
  vi.mocked(getRequiredUserId).mockReset()
  vi.mocked(getRequiredUserId).mockResolvedValue(USER_ID)
})

describe('getTabAnnotationsAction', () => {
  it('returns the stored annotations object for an authorized caller', async () => {
    const storedAnnotations = { '1': sampleStrokes }
    vi.mocked(query)
      // checkAccess SELECT
      .mockResolvedValueOnce({ rows: [{ id: REPERTOIRE_ID }] } as any)
      // SELECT annotations
      .mockResolvedValueOnce({ rows: [{ annotations: storedAnnotations }] } as any)

    const result = await getTabAnnotationsAction(TAB_ID, REPERTOIRE_ID)

    expect(result).toEqual({ data: storedAnnotations })
  })

  it("returns { error: 'Tab not found' } when the tab id/repertoire id pair doesn't match a row", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: REPERTOIRE_ID }] } as any) // checkAccess passes
      .mockResolvedValueOnce({ rows: [] } as any) // no matching tab row

    const result = await getTabAnnotationsAction(TAB_ID, REPERTOIRE_ID)

    expect(result).toEqual({ error: 'Tab not found' })
  })

  it('propagates the checkAccess denial for a caller who owns neither the personal entry nor a band membership', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any) // checkAccess fails

    const result = await getTabAnnotationsAction(TAB_ID, REPERTOIRE_ID)

    expect(result).toEqual({ error: 'Access denied' })
  })
})

describe('saveTabAnnotationsAction', () => {
  it('issues an UPDATE ... jsonb_set ... RETURNING id call and returns { success: true } on a non-empty rows result', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: REPERTOIRE_ID }] } as any) // checkAccess passes
      .mockResolvedValueOnce({ rows: [{ id: TAB_ID }] } as any) // UPDATE affected 1 row

    const result = await saveTabAnnotationsAction(TAB_ID, REPERTOIRE_ID, 3, sampleStrokes)

    expect(result).toEqual({ success: true })

    const updateCall = vi.mocked(query).mock.calls[1]
    expect(updateCall[0]).toMatch(/UPDATE repertoire_tabs/)
    expect(updateCall[0]).toMatch(/jsonb_set/)
    expect(updateCall[0]).toMatch(/RETURNING id/)
    expect(updateCall[1]).toEqual([TAB_ID, REPERTOIRE_ID, '{3}', JSON.stringify(sampleStrokes)])
  })

  it("returns { error: 'Tab not found' } (not { success: true }) when the UPDATE affects zero rows", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: REPERTOIRE_ID }] } as any) // checkAccess passes
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE matched nothing

    const result = await saveTabAnnotationsAction(TAB_ID, REPERTOIRE_ID, 1, sampleStrokes)

    expect(result).toEqual({ error: 'Tab not found' })
  })

  it('propagates the checkAccess denial for a caller who owns neither the personal entry nor a band membership', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any) // checkAccess fails

    const result = await saveTabAnnotationsAction(TAB_ID, REPERTOIRE_ID, 1, sampleStrokes)

    expect(result).toEqual({ error: 'Access denied' })
  })

  it('returns { error: ... } (not a thrown exception) on a DB error', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: REPERTOIRE_ID }] } as any) // checkAccess passes
      .mockRejectedValueOnce(new Error('connection lost'))

    const result = await saveTabAnnotationsAction(TAB_ID, REPERTOIRE_ID, 1, sampleStrokes)

    expect(result).toEqual({ error: 'connection lost' })
  })
})
