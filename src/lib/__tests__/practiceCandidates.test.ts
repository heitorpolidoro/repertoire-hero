/** RH-168 - the practice read picks the owner's table, authorizes a playlist and never writes. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('@/lib/playlists', () => ({ assertPlaylistAccess: vi.fn() }))

import { query } from '@/lib/db'
import { assertPlaylistAccess } from '@/lib/playlists'
import { getPracticeCandidates, listPracticePlaylists } from '../practiceCandidates'

const mockQuery = vi.mocked(query)

beforeEach(() => {
  vi.resetAllMocks()
})

function rows(list: unknown[]) {
  mockQuery.mockResolvedValue({ rows: list, rowCount: list.length } as never)
}

describe('getPracticeCandidates', () => {
  it('reads the personal repertoire from user_songs and maps the row', async () => {
    const when = new Date('2026-01-02T03:04:05.000Z')
    rows([
      { version_id: 'v1', title: 'T', artist: 'A', status: 'learning', last_practiced: when },
      { version_id: 'v2', title: 'U', artist: null, status: null, last_practiced: null },
      { version_id: 'v3', title: 'V', artist: null, status: 'mastered', last_practiced: '2026-01-01T00:00:00.000Z' },
    ])

    const result = await getPracticeCandidates('u-1', { kind: 'repertoire' }, null)

    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('FROM user_songs o')
    expect(sql).toContain('o.user_id = $1')
    expect(params).toEqual(['u-1'])
    expect(assertPlaylistAccess).not.toHaveBeenCalled()
    expect(result).toEqual([
      { versionId: 'v1', title: 'T', artist: 'A', status: 'learning', lastPracticed: when.toISOString() },
      { versionId: 'v2', title: 'U', artist: null, status: null, lastPracticed: null },
      { versionId: 'v3', title: 'V', artist: null, status: 'mastered', lastPracticed: '2026-01-01T00:00:00.000Z' },
    ])
  })

  it('reads a band repertoire from band_songs', async () => {
    rows([])
    await getPracticeCandidates('u-1', { kind: 'repertoire' }, 'b-1')
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('FROM band_songs o')
    expect(params).toEqual(['b-1'])
  })

  it('authorizes a playlist, then reads its entries with a LEFT JOIN on the owner table', async () => {
    rows([])
    await getPracticeCandidates('u-1', { kind: 'playlist', playlistId: 'p-1' }, 'b-1')
    expect(assertPlaylistAccess).toHaveBeenCalledWith('p-1', 'u-1')
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('LEFT JOIN band_songs o')
    expect(params).toEqual(['b-1', 'p-1'])
  })

  it('reads a personal playlist against user_songs', async () => {
    rows([])
    await getPracticeCandidates('u-1', { kind: 'playlist', playlistId: 'p-1' }, null)
    expect(mockQuery.mock.calls[0][0]).toContain('LEFT JOIN user_songs o')
    expect(mockQuery.mock.calls[0][1]).toEqual(['u-1', 'p-1'])
  })

  it('refuses a playlist the caller cannot reach before reading', async () => {
    vi.mocked(assertPlaylistAccess).mockRejectedValue(new Error('Access denied: not allowed on this playlist'))
    await expect(
      getPracticeCandidates('u-1', { kind: 'playlist', playlistId: 'p-1' }, null),
    ).rejects.toThrow('Access denied')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('only ever issues SELECT statements', async () => {
    rows([])
    await getPracticeCandidates('u-1', { kind: 'repertoire' }, null)
    await getPracticeCandidates('u-1', { kind: 'playlist', playlistId: 'p' }, 'b')
    for (const [sql] of mockQuery.mock.calls) expect(String(sql).trim()).toMatch(/^SELECT/)
  })

  it('wraps a database failure with the prefixed message', async () => {
    mockQuery.mockRejectedValue(new Error('boom'))
    await expect(getPracticeCandidates('u-1', { kind: 'repertoire' }, null)).rejects.toThrow(
      'Failed to fetch practice candidates: boom',
    )
    mockQuery.mockRejectedValue('plain')
    await expect(getPracticeCandidates('u-1', { kind: 'repertoire' }, null)).rejects.toThrow('plain')
  })
})

describe('listPracticePlaylists', () => {
  it('lists the personal playlists by user_id', async () => {
    rows([{ id: 'p-1', name: 'Set' }])
    expect(await listPracticePlaylists('u-1', null)).toEqual([{ id: 'p-1', name: 'Set' }])
    expect(mockQuery.mock.calls[0][0]).toContain('user_id = $1')
    expect(mockQuery.mock.calls[0][1]).toEqual(['u-1'])
  })

  it('lists a band playlists by band_id', async () => {
    rows([])
    await listPracticePlaylists('u-1', 'b-1')
    expect(mockQuery.mock.calls[0][0]).toContain('band_id = $1')
    expect(mockQuery.mock.calls[0][1]).toEqual(['b-1'])
  })

  it('wraps a failure', async () => {
    mockQuery.mockRejectedValue(new Error('boom'))
    await expect(listPracticePlaylists('u-1', null)).rejects.toThrow('Failed to fetch practice playlists: boom')
  })
})
