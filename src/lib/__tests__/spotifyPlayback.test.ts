import { describe, it, expect } from 'vitest'
import { decidePlayback, hasPlaybackScopes, PLAYBACK_SCOPES } from '../spotifyPlayback'

const URI = 'spotify:track:abc123'
const ALL = `playlist-read-private user-read-private ${PLAYBACK_SCOPES.join(' ')}`
const base = { trackUri: URI, offline: false, facts: { connected: true, scope: ALL, premium: true } }

describe('hasPlaybackScopes', () => {
  it('is false for null, empty and partial scope strings', () => {
    expect(hasPlaybackScopes(null)).toBe(false)
    expect(hasPlaybackScopes('')).toBe(false)
    expect(hasPlaybackScopes('streaming user-read-playback-state')).toBe(false)
  })
  it('is true when all three are present', () => {
    expect(hasPlaybackScopes(ALL)).toBe(true)
  })
})

describe('decidePlayback', () => {
  it('hides when there is no track uri, whatever else is true', () => {
    expect(decidePlayback({ ...base, trackUri: null })).toEqual({ kind: 'hidden' })
  })
  it('reports loading until the facts arrive', () => {
    expect(decidePlayback({ ...base, facts: null })).toEqual({ kind: 'loading' })
  })
  it('reports offline before anything else once a uri exists', () => {
    expect(decidePlayback({ ...base, offline: true })).toEqual({ kind: 'offline' })
    expect(decidePlayback({ ...base, offline: true, facts: null })).toEqual({ kind: 'offline' })
  })
  it('asks to reconnect when not connected', () => {
    expect(decidePlayback({ ...base, facts: { connected: false, scope: null, premium: false } })).toEqual({ kind: 'reconnect' })
  })
  it('asks to reconnect when scopes are missing (legacy row, null scope)', () => {
    expect(decidePlayback({ ...base, facts: { connected: true, scope: null, premium: true } })).toEqual({ kind: 'reconnect' })
  })
  it('requires Premium when scopes are fine but the account is free', () => {
    expect(decidePlayback({ ...base, facts: { connected: true, scope: ALL, premium: false } })).toEqual({ kind: 'premium-required' })
  })
  it('is ready otherwise, carrying the uri', () => {
    expect(decidePlayback(base)).toEqual({ kind: 'ready', trackUri: URI })
  })
})
