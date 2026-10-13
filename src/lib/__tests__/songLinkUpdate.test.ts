/**
 * RH-138 — `applySongLinkUpdate` no longer queues the whole array: an added link
 * is written at once and each removed link becomes a row-keyed suggestion.
 * Statement-level unit test; the DB-backed counterpart is in `songs.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  submit: vi.fn(),
  fetchTitle: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: mocks.query,
  pool: { query: vi.fn() },
  withTransaction: (fn: (client: { query: typeof mocks.clientQuery }) => unknown) =>
    fn({ query: mocks.clientQuery }),
}))
vi.mock('@/lib/moderation', () => ({ submitCatalogSuggestion: mocks.submit }))
vi.mock('@/lib/linkFetcher', () => ({ fetchUrlTitle: mocks.fetchTitle }))

import { applySongLinkUpdate } from '../songs'

const CHORDS = { id: 'link-chords', url: 'https://tabs.example/chords' }
const VIDEO = { id: 'link-video', url: 'https://youtu.be/video' }

beforeEach(() => {
  mocks.query.mockReset()
  mocks.clientQuery.mockReset()
  mocks.submit.mockReset()
  mocks.fetchTitle.mockReset()
  mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'song-1' }] })
})

/** Queues the transaction's `SELECT id, url FROM song_links` answer. */
function holdsLinks(rows: Array<{ id: string; url: string }>) {
  mocks.clientQuery.mockResolvedValueOnce({ rowCount: rows.length, rows })
  mocks.clientQuery.mockResolvedValue({ rowCount: 1, rows: [] })
}

describe('applySongLinkUpdate', () => {
  it('writes an added link at once and queues nothing', async () => {
    holdsLinks([CHORDS])

    await expect(
      applySongLinkUpdate('user-1', 'song-1', [
        { label: 'Chords', url: CHORDS.url },
        { label: 'Video', url: VIDEO.url },
      ]),
    ).resolves.toEqual({ success: true })

    expect(mocks.clientQuery.mock.calls[1][0]).toContain('INSERT INTO song_links')
    expect(mocks.clientQuery.mock.calls[2][0]).toBe('UPDATE songs SET updated_at = now() WHERE id = $1')
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('queues a removal keyed by the link id, writes the add, and reports pending', async () => {
    holdsLinks([CHORDS, VIDEO])

    await expect(
      applySongLinkUpdate('user-1', 'song-1', [
        { label: 'Video', url: VIDEO.url },
        { label: 'Fresh', url: 'https://fresh.example/x' },
      ]),
    ).resolves.toEqual({ success: true, pending: true })

    // The add landed in the same pass...
    expect(mocks.clientQuery.mock.calls[1][0]).toContain('INSERT INTO song_links')
    // ...and only the absent row waits, addressed by id and never as an array.
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(mocks.submit).toHaveBeenCalledWith('user-1', 'song-1', {
      linkChanges: [{ linkId: CHORDS.id, removed: true }],
    })
  })

  it('queues every row when all links are removed, and writes nothing else', async () => {
    holdsLinks([CHORDS, VIDEO])

    await expect(applySongLinkUpdate('user-1', 'song-1', [])).resolves.toEqual({
      success: true,
      pending: true,
    })

    expect(mocks.clientQuery).toHaveBeenCalledTimes(1) // the read only
    expect(mocks.submit).toHaveBeenCalledWith('user-1', 'song-1', {
      linkChanges: [
        { linkId: CHORDS.id, removed: true },
        { linkId: VIDEO.id, removed: true },
      ],
    })
  })

  it('throws Song entry not found for an unknown song, before anything is written', async () => {
    mocks.query.mockResolvedValue({ rowCount: 0, rows: [] })

    await expect(applySongLinkUpdate('user-1', 'nope', [])).rejects.toThrow('Song entry not found')
    expect(mocks.clientQuery).not.toHaveBeenCalled()
  })
})
