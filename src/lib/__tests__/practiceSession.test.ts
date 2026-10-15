/** RH-168 - the queue and first Fast View href a start produces. */
import { describe, it, expect } from 'vitest'
import { buildPracticeSession } from '../practiceSession'

const rich = (id: string) => ({
  versionId: id,
  title: `T-${id}`,
  artist: id === 'v2' ? null : `A-${id}`,
  status: 'learning' as const,
  lastPracticed: '2026-01-01T00:00:00.000Z',
})

describe('buildPracticeSession', () => {
  it('builds a band playlist start', () => {
    const session = buildPracticeSession({
      ordered: [rich('v1'), rich('v2')],
      owner: { type: 'band', bandId: 'b-1' },
      source: { kind: 'playlist', name: 'Friday gig' },
    })
    expect(session).toEqual({
      queue: {
        entries: [
          { versionId: 'v1', title: 'T-v1', artist: 'A-v1' },
          { versionId: 'v2', title: 'T-v2', artist: null },
        ],
        owner: { type: 'band', bandId: 'b-1' },
        originHref: '/bands/b-1',
        label: 'Friday gig',
      },
      href: '/songs/v1/fast-view?bandId=b-1',
    })
  })

  it('builds a personal whole-repertoire start', () => {
    const session = buildPracticeSession({
      ordered: [rich('v9')],
      owner: { type: 'personal' },
      source: { kind: 'repertoire' },
    })
    expect(session?.queue.owner).toEqual({ type: 'personal' })
    expect(session?.queue.originHref).toBe('/')
    expect(session?.queue.label).toBe('Whole repertoire')
    expect(session?.href).toBe('/songs/v9/fast-view')
  })

  it('lets an explicit originHref win over the owner-derived one', () => {
    const session = buildPracticeSession({
      ordered: [rich('v1')],
      owner: { type: 'band', bandId: 'b-1' },
      source: { kind: 'repertoire' },
      originHref: '/playlists/p-1',
    })
    expect(session?.queue.originHref).toBe('/playlists/p-1')
    expect(session?.href).toBe('/songs/v1/fast-view?bandId=b-1')
  })

  it('returns null for an empty list', () => {
    expect(
      buildPracticeSession({ ordered: [], owner: { type: 'personal' }, source: { kind: 'repertoire' } }),
    ).toBeNull()
  })
})
