import { describe, it, expect } from 'vitest'
import { playlistSummary } from '../playlistSummary'

const withDurations = (...secs: Array<number | null | undefined>) => ({
  songs: secs.map((duration_seconds) => ({ song: { duration_seconds } })),
})

describe('playlistSummary', () => {
  it('counts songs and omits the total when no duration is known', () => {
    expect(playlistSummary({})).toBe('0 songs')
    expect(playlistSummary(withDurations(null))).toBe('1 song')
  })

  it('appends minutes:seconds under an hour', () => {
    expect(playlistSummary(withDurations(125, 60))).toBe('2 songs · 3:05')
  })

  it('appends h:mm:ss from an hour up', () => {
    expect(playlistSummary(withDurations(3600, 125))).toBe('2 songs · 1:02:05')
  })
})
