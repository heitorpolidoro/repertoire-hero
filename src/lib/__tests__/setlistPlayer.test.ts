import { describe, it, expect, vi } from 'vitest'
import {
  advance,
  counterText,
  needsSpotifyFacts,
  pickSource,
  skippedText,
  stepIndex,
  tapToPlayText,
  type PickedSource,
  type QueueSources,
} from '../setlistPlayer'
import type { PlaybackFacts } from '../spotifyPlayback'

const READY: PlaybackFacts = {
  connected: true,
  scope: 'streaming user-read-playback-state user-modify-playback-state',
  premium: true,
}
const SPOTIFY = 'https://open.spotify.com/track/abc123'
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const ALL: QueueSources = {
  audio: { fileUrl: 'https://blob.example/a.mp3', title: 'Backing' },
  spotifyUrl: SPOTIFY,
  youtubeUrl: YOUTUBE,
}

describe('pickSource', () => {
  it('prefers uploaded audio over everything', () => {
    expect(pickSource({ sources: ALL, offline: false, facts: READY })).toEqual({
      kind: 'file',
      url: 'https://blob.example/a.mp3',
    })
  })

  it('prefers a ready Spotify track over YouTube', () => {
    const sources = { spotifyUrl: SPOTIFY, youtubeUrl: YOUTUBE }
    expect(pickSource({ sources, offline: false, facts: READY })).toEqual({
      kind: 'spotify',
      trackUri: 'spotify:track:abc123',
    })
  })

  it.each([
    ['no facts yet', null],
    ['not connected', { ...READY, connected: false }],
    ['missing scopes', { ...READY, scope: null }],
    ['no premium', { ...READY, premium: false }],
  ])('falls to YouTube when Spotify is not ready (%s)', (_name, facts) => {
    const sources = { spotifyUrl: SPOTIFY, youtubeUrl: YOUTUBE }
    expect(pickSource({ sources, offline: false, facts })).toEqual({ kind: 'youtube', videoId: 'dQw4w9WgXcQ' })
  })

  it('gives no Spotify source for a short link (no uri)', () => {
    const sources = { spotifyUrl: 'https://spotify.link/xyz' }
    expect(pickSource({ sources, offline: false, facts: READY })).toBeNull()
  })

  it('returns null with no source, with an unparseable YouTube link, and offline', () => {
    expect(pickSource({ sources: {}, offline: false, facts: READY })).toBeNull()
    expect(pickSource({ sources: { youtubeUrl: 'https://youtube.com/@chan' }, offline: false, facts: null })).toBeNull()
    expect(pickSource({ sources: ALL, offline: true, facts: READY })).toBeNull()
  })
})

describe('needsSpotifyFacts', () => {
  it('is true only with a track uri and no uploaded audio', () => {
    expect(needsSpotifyFacts({ spotifyUrl: SPOTIFY })).toBe(true)
    expect(needsSpotifyFacts({ spotifyUrl: SPOTIFY, audio: ALL.audio })).toBe(false)
    expect(needsSpotifyFacts({ spotifyUrl: 'https://spotify.link/x' })).toBe(false)
    expect(needsSpotifyFacts({ youtubeUrl: YOUTUBE })).toBe(false)
  })
})

describe('stepIndex', () => {
  it('moves one step and never wraps', () => {
    expect(stepIndex(0, 3, 1)).toBe(1)
    expect(stepIndex(2, 3, 1)).toBeNull()
    expect(stepIndex(2, 3, -1)).toBe(1)
    expect(stepIndex(0, 3, -1)).toBeNull()
  })
})

describe('texts', () => {
  it('formats the counter over the whole queue and the two messages', () => {
    expect(counterText(1, 5)).toBe('2 / 5')
    expect(skippedText('Song')).toBe('Skipped: Song (no audio or video)')
    expect(tapToPlayText('Song')).toBe('Tap to play Song')
  })
})

describe('advance', () => {
  const entries = ['a', 'b', 'c', 'd'].map((id) => ({ versionId: id, title: id.toUpperCase(), artist: null }))
  const file: PickedSource = { kind: 'file', url: 'u' }
  const only = (id: string) => async (e: { versionId: string }) => (e.versionId === id ? file : null)
  const none = async () => null

  it('returns the first playable entry from the start index, reporting passed-over ones', async () => {
    const onSkip = vi.fn()
    expect(await advance({ entries, from: 0, direction: 1, resolve: only('c'), onSkip })).toEqual({
      index: 2,
      source: file,
    })
    expect(onSkip.mock.calls).toEqual([['A'], ['B']])
  })

  it('stops at the end without wrapping when nothing playable follows', async () => {
    const onSkip = vi.fn()
    expect(await advance({ entries, from: 1, direction: 1, resolve: only('a'), onSkip })).toBeNull()
    expect(onSkip).toHaveBeenCalledTimes(3)
  })

  it('walks backwards the same way and stops at the start', async () => {
    expect(await advance({ entries, from: 3, direction: -1, resolve: only('b'), onSkip: () => {} })).toEqual({
      index: 1,
      source: file,
    })
    expect(await advance({ entries, from: 0, direction: -1, resolve: none, onSkip: () => {} })).toBeNull()
  })

  it('returns null for a start index outside the queue', async () => {
    expect(await advance({ entries, from: 4, direction: 1, resolve: only('a'), onSkip: () => {} })).toBeNull()
  })
})
