/**
 * RH-154 — the catalog admin actions only resolve the session and delegate.
 * The admin gate lives in `@/lib/catalogAdmin` (see catalogAdmin.db.test.ts);
 * here a rejection from it must surface unchanged through each action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/catalogAdmin', () => ({
  getCatalogBlastRadius: vi.fn(),
  mergeSongVersions: vi.fn(),
  deleteSongVersion: vi.fn(),
}))

import {
  deleteSongVersionAction,
  getCatalogBlastRadiusAction,
  mergeSongVersionsAction,
} from '../catalogAdmin'
import { getRequiredUserId } from '@/lib/auth-session'
import {
  deleteSongVersion,
  getCatalogBlastRadius,
  mergeSongVersions,
} from '@/lib/catalogAdmin'

const DENIED = new Error('Access denied: User is not a system admin')

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getRequiredUserId).mockResolvedValue('admin-1')
})

describe('catalog admin actions', () => {
  it('delegates the blast radius with the session user id', async () => {
    vi.mocked(getCatalogBlastRadius).mockResolvedValue({ repertoires: 1, playlists: 2 })
    await expect(getCatalogBlastRadiusAction({ versionId: 'v1' })).resolves.toEqual({
      repertoires: 1,
      playlists: 2,
    })
    expect(getCatalogBlastRadius).toHaveBeenCalledWith('admin-1', { versionId: 'v1' })
  })

  it('delegates the merge with the session user id', async () => {
    await mergeSongVersionsAction('a', 'b')
    expect(mergeSongVersions).toHaveBeenCalledWith('admin-1', 'a', 'b')
  })

  it('delegates the delete with the session user id', async () => {
    await deleteSongVersionAction('v1')
    expect(deleteSongVersion).toHaveBeenCalledWith('admin-1', 'v1')
  })

  it('surfaces the admin-denied rejection from each action', async () => {
    vi.mocked(getCatalogBlastRadius).mockRejectedValue(DENIED)
    vi.mocked(mergeSongVersions).mockRejectedValue(DENIED)
    vi.mocked(deleteSongVersion).mockRejectedValue(DENIED)
    await expect(getCatalogBlastRadiusAction({ songId: 's' })).rejects.toThrow(DENIED.message)
    await expect(mergeSongVersionsAction('a', 'b')).rejects.toThrow(DENIED.message)
    await expect(deleteSongVersionAction('a')).rejects.toThrow(DENIED.message)
  })

  it('does not touch the lib without a session', async () => {
    vi.mocked(getRequiredUserId).mockRejectedValue(new Error('Not authenticated'))
    await expect(mergeSongVersionsAction('a', 'b')).rejects.toThrow('Not authenticated')
    expect(mergeSongVersions).not.toHaveBeenCalled()
  })
})
