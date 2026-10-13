/** RH-168 - the practice read: a non-member of the band is refused, a member reads. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/bands', () => ({ assertBandMember: vi.fn() }))
vi.mock('@/lib/practiceCandidates', () => ({
  getPracticeCandidates: vi.fn(),
  listPracticePlaylists: vi.fn(),
}))

import { getPracticeCandidatesAction, getPracticePlaylistsAction } from '../practice'
import { getRequiredUserId } from '@/lib/auth-session'
import { assertBandMember } from '@/lib/bands'
import { getPracticeCandidates, listPracticePlaylists } from '@/lib/practiceCandidates'

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getRequiredUserId).mockResolvedValue('user-1')
})

describe('getPracticeCandidatesAction', () => {
  it('refuses a non-member before any read', async () => {
    vi.mocked(assertBandMember).mockRejectedValue(new Error('Access denied: not a member of this band'))
    await expect(getPracticeCandidatesAction({ kind: 'repertoire' }, 'band-1')).rejects.toThrow('Access denied')
    expect(getPracticeCandidates).not.toHaveBeenCalled()
  })

  it('lets a member read the band', async () => {
    vi.mocked(assertBandMember).mockResolvedValue('member')
    vi.mocked(getPracticeCandidates).mockResolvedValue([])
    await getPracticeCandidatesAction({ kind: 'playlist', playlistId: 'p-1' }, 'band-1')
    expect(assertBandMember).toHaveBeenCalledWith('band-1', 'user-1')
    expect(getPracticeCandidates).toHaveBeenCalledWith('user-1', { kind: 'playlist', playlistId: 'p-1' }, 'band-1')
  })

  it('reads the personal repertoire without a band check', async () => {
    vi.mocked(getPracticeCandidates).mockResolvedValue([])
    await getPracticeCandidatesAction({ kind: 'repertoire' }, null)
    expect(assertBandMember).not.toHaveBeenCalled()
    expect(getPracticeCandidates).toHaveBeenCalledWith('user-1', { kind: 'repertoire' }, null)
  })
})

describe('getPracticePlaylistsAction', () => {
  it('refuses a non-member', async () => {
    vi.mocked(assertBandMember).mockRejectedValue(new Error('Access denied: not a member of this band'))
    await expect(getPracticePlaylistsAction('band-1')).rejects.toThrow('Access denied')
    expect(listPracticePlaylists).not.toHaveBeenCalled()
  })

  it('lists for a member and for the personal owner', async () => {
    vi.mocked(assertBandMember).mockResolvedValue('admin')
    vi.mocked(listPracticePlaylists).mockResolvedValue([{ id: 'p', name: 'n' }])
    expect(await getPracticePlaylistsAction('band-1')).toEqual([{ id: 'p', name: 'n' }])
    await getPracticePlaylistsAction(null)
    expect(listPracticePlaylists).toHaveBeenLastCalledWith('user-1', null)
  })
})
